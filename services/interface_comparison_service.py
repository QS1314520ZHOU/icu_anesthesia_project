"""
接口智能对照引擎
核心：我方标准接口 vs 对方厂商接口的逐接口、逐字段、逐类型比对。
"""
import json
import re
import logging
from database import DatabasePool
from services.ai_service import ai_service

logger = logging.getLogger(__name__)


class InterfaceComparisonService:

    # ========== 第一阶段：接口匹配 ==========

    def auto_match_interfaces(self, project_id: int, category: str = None) -> list:
        """
        自动匹配我方接口 and 对方接口的对应关系。
        三轮策略：transcode精确匹配 → system_type+名称模糊匹配 → AI语义推理
        """
        with DatabasePool.get_connection() as conn:
            query = '''
                SELECT id, interface_name, transcode, system_type, description, action_name, view_name
                FROM interface_specs
                WHERE (project_id = ? OR project_id IS NULL) AND spec_source = 'our_standard'
            '''
            params = [project_id]
            if category:
                query += ' AND category = ?'
                params.append(category)
            
            our_specs = [dict(s) for s in conn.execute(query, params).fetchall()]

            vendor_specs = [dict(s) for s in conn.execute('''
                SELECT id, interface_name, transcode, system_type, description, action_name, view_name
                FROM interface_specs
                WHERE project_id = ? AND spec_source = 'vendor'
            ''', (project_id,)).fetchall()]

        if not our_specs or not vendor_specs:
            return []

        matches = []
        used_vendor_ids = set()

        # --- 第1轮：transcode / action_name / view_name 精确匹配 ---
        for our in our_specs:
            for vendor in vendor_specs:
                if vendor['id'] in used_vendor_ids:
                    continue
                matched = False
                reason = ''

                # transcode 匹配
                if (our.get('transcode') and vendor.get('transcode') and
                    our['transcode'].strip().lower() == vendor['transcode'].strip().lower()):
                    matched = True
                    reason = f"transcode 精确匹配: {our['transcode']}"

                # action_name 匹配
                if not matched and our.get('action_name') and vendor.get('action_name'):
                    if our['action_name'].strip().lower() == vendor['action_name'].strip().lower():
                        matched = True
                        reason = f"action 精确匹配: {our['action_name']}"

                # view_name 匹配
                if not matched and our.get('view_name') and vendor.get('view_name'):
                    if our['view_name'].strip().lower() == vendor['view_name'].strip().lower():
                        matched = True
                        reason = f"视图名精确匹配: {our['view_name']}"

                if matched:
                    matches.append({
                        'our_spec_id': our['id'],
                        'vendor_spec_id': vendor['id'],
                        'match_type': 'auto',
                        'match_confidence': 1.0,
                        'match_reason': reason
                    })
                    used_vendor_ids.add(vendor['id'])
                    break

        # --- 第2轮：同 system_type + 接口名称包含关系 ---
        unmatched_ours = [s for s in our_specs if s['id'] not in {m['our_spec_id'] for m in matches}]
        for our in unmatched_ours:
            best_match = None
            best_score = 0
            for vendor in vendor_specs:
                if vendor['id'] in used_vendor_ids:
                    continue
                if our.get('system_type', '').lower() != vendor.get('system_type', '').lower():
                    continue
                # 名称相似度：简单包含 + 共同关键词
                score = self._name_similarity(our['interface_name'], vendor['interface_name'])
                if score > best_score and score >= 0.5:
                    best_score = score
                    best_match = vendor

            if best_match:
                matches.append({
                    'our_spec_id': our['id'],
                    'vendor_spec_id': best_match['id'],
                    'match_type': 'auto',
                    'match_confidence': round(best_score, 2),
                    'match_reason': f"名称相似度匹配 ({best_score:.0%}): {our['interface_name']} ↔ {best_match['interface_name']}"
                })
                used_vendor_ids.add(best_match['id'])

        # --- 第3轮：AI 语义匹配（剩余未匹配的）---
        still_unmatched_ours = [s for s in our_specs if s['id'] not in {m['our_spec_id'] for m in matches}]
        still_unmatched_vendors = [s for s in vendor_specs if s['id'] not in used_vendor_ids]
        if still_unmatched_ours and still_unmatched_vendors:
            ai_matches = self._ai_semantic_match(still_unmatched_ours, still_unmatched_vendors)
            for am in ai_matches:
                if am['vendor_spec_id'] not in used_vendor_ids:
                    matches.append(am)
                    used_vendor_ids.add(am['vendor_spec_id'])

        # --- 标记我方未匹配的接口 ---
        all_matched_our_ids = {m['our_spec_id'] for m in matches}
        for our in our_specs:
            if our['id'] not in all_matched_our_ids:
                matches.append({
                    'our_spec_id': our['id'],
                    'vendor_spec_id': None,
                    'match_type': 'auto',
                    'match_confidence': 0,
                    'match_reason': f"⚠️ 对方文档中未找到「{our['interface_name']}」对应接口"
                })

        # --- 标记对方多余的接口 ---
        for vendor in vendor_specs:
            if vendor['id'] not in used_vendor_ids:
                matches.append({
                    'our_spec_id': None,
                    'vendor_spec_id': vendor['id'],
                    'match_type': 'auto',
                    'match_confidence': 0,
                    'match_reason': f"ℹ️ 对方额外提供的接口: {vendor['interface_name']}"
                })

        return matches

    def _name_similarity(self, name1: str, name2: str) -> float:
        """简单中文名称相似度"""
        if not name1 or not name2:
            return 0
        n1 = set(name1.replace(' ', ''))
        n2 = set(name2.replace(' ', ''))
        if not n1 or not n2:
            return 0
        intersection = n1 & n2
        union = n1 | n2
        return len(intersection) / len(union)

    def _ai_semantic_match(self, our_list, vendor_list):
        """AI 语义匹配剩余接口"""
        our_str = "\n".join([f"[{s['id']}] {s['interface_name']}({s['system_type']}) - {s.get('description','')}" for s in our_list])
        vendor_str = "\n".join([f"[{s['id']}] {s['interface_name']}({s['system_type']}) - {s.get('description','')}" for s in vendor_list])

        prompt = f"""请匹配以下两组医疗信息系统接口（按功能语义匹配）：

我方接口:
{our_str}

对方接口:
{vendor_str}

直接输出 JSON 数组: [{{"our_id": 数字, "vendor_id": 数字, "confidence": 0到1, "reason": "理由"}}]
只输出 confidence >= 0.6 的，不确定的不要输出。"""

        result = ai_service.call_ai_api("你是接口匹配专家，只输出JSON。", prompt, task_type="analysis")
        matches = []
        if result:
            json_match = re.search(r'\[[\s\S]*?\]', result)
            if json_match:
                try:
                    for item in json.loads(json_match.group()):
                        matches.append({
                            'our_spec_id': item['our_id'],
                            'vendor_spec_id': item['vendor_id'],
                            'match_type': 'auto',
                            'match_confidence': item.get('confidence', 0.7),
                            'match_reason': f"AI语义匹配: {item.get('reason', '')}"
                        })
                except:
                    pass
        return matches

    # ========== 第二阶段：字段对照 ==========

    def compare_fields(self, our_spec_id: int, vendor_spec_id: int) -> dict:
        """逐字段对照两个接口"""
        with DatabasePool.get_connection() as conn:
            our_spec = dict(conn.execute('SELECT * FROM interface_specs WHERE id = ?', (our_spec_id,)).fetchone())
            vendor_spec = dict(conn.execute('SELECT * FROM interface_specs WHERE id = ?', (vendor_spec_id,)).fetchone())
            our_fields = [dict(f) for f in conn.execute(
                'SELECT * FROM interface_spec_fields WHERE spec_id = ? ORDER BY field_order', (our_spec_id,)).fetchall()]
            vendor_fields = [dict(f) for f in conn.execute(
                'SELECT * FROM interface_spec_fields WHERE spec_id = ? ORDER BY field_order', (vendor_spec_id,)).fetchall()]

        # 构建对方字段的多维索引
        vendor_index = {}
        for vf in vendor_fields:
            vendor_index[vf['field_name'].lower()] = vf
            vendor_index[vf['field_name'].upper()] = vf
            if vf.get('field_name_cn'):
                vendor_index[vf['field_name_cn']] = vf

        mappings = []
        matched_vendor_ids = set()

        for of in our_fields:
            vf = None
            status = 'missing_in_vendor'
            transform_rule = None

            # 尝试匹配
            candidates = [
                of['field_name'].lower(),
                of['field_name'].upper(),
                of.get('field_name_cn', ''),
            ]
            for key in candidates:
                if key and key in vendor_index:
                    vf = vendor_index[key]
                    break

            if vf:
                matched_vendor_ids.add(vf['id'])
                # 判断状态
                name_same = of['field_name'].lower() == vf['field_name'].lower()
                type_same = self._types_compatible(of.get('field_type', ''), vf.get('field_type', ''))

                if name_same and type_same:
                    status = 'matched'
                elif not name_same:
                    status = 'name_different'
                elif not type_same:
                    status = 'type_mismatch'

                transform_rule = self._detect_transform(of, vf)
                if transform_rule:
                    status = 'needs_transform'

            mappings.append({
                'our_field_id': of['id'],
                'vendor_field_id': vf['id'] if vf else None,
                'our_field_name': of['field_name'],
                'our_field_cn': of.get('field_name_cn', ''),
                'vendor_field_name': vf['field_name'] if vf else None,
                'vendor_field_cn': vf.get('field_name_cn', '') if vf else '',
                'mapping_status': status,
                'transform_rule': transform_rule,
                'our_type': of.get('field_type', ''),
                'vendor_type': vf.get('field_type', '') if vf else '',
                'our_required': of.get('is_required', 0),
                'vendor_required': vf.get('is_required', 0) if vf else 0,
                'our_desc': of.get('description', ''),
                'vendor_desc': vf.get('description', '') if vf else '',
            })

        # 对方有、我方没有
        for vf in vendor_fields:
            if vf['id'] not in matched_vendor_ids:
                mappings.append({
                    'our_field_id': None,
                    'vendor_field_id': vf['id'],
                    'our_field_name': None,
                    'vendor_field_name': vf['field_name'],
                    'vendor_field_cn': vf.get('field_name_cn', ''),
                    'mapping_status': 'extra_in_vendor',
                    'transform_rule': None,
                    'vendor_type': vf.get('field_type', ''),
                })

        stats = {
            'our_total': len(our_fields),
            'vendor_total': len(vendor_fields),
            'matched': sum(1 for m in mappings if m['mapping_status'] == 'matched'),
            'name_different': sum(1 for m in mappings if m['mapping_status'] == 'name_different'),
            'type_mismatch': sum(1 for m in mappings if m['mapping_status'] == 'type_mismatch'),
            'needs_transform': sum(1 for m in mappings if m['mapping_status'] == 'needs_transform'),
            'missing_in_vendor': sum(1 for m in mappings if m['mapping_status'] == 'missing_in_vendor'),
            'extra_in_vendor': sum(1 for m in mappings if m['mapping_status'] == 'extra_in_vendor'),
        }
        # 必填字段缺失（最关键的风险点）
        stats['required_missing'] = sum(
            1 for m in mappings
            if m['mapping_status'] == 'missing_in_vendor' and m.get('our_required') == 1
        )

        return {
            'our_spec': {'id': our_spec['id'], 'name': our_spec['interface_name'],
                         'transcode': our_spec.get('transcode', ''), 'protocol': our_spec.get('protocol', '')},
            'vendor_spec': {'id': vendor_spec['id'], 'name': vendor_spec['interface_name'],
                            'transcode': vendor_spec.get('transcode', ''), 'protocol': vendor_spec.get('protocol', '')},
            'mappings': mappings,
            'stats': stats,
            'protocol_match': (our_spec.get('protocol', '').lower() == vendor_spec.get('protocol', '').lower())
        }

    def _types_compatible(self, type1: str, type2: str) -> bool:
        """判断两个字段类型是否兼容"""
        if not type1 or not type2:
            return True
        t1 = type1.lower().strip()
        t2 = type2.lower().strip()
        if t1 == t2:
            return True
        # 常见等价类型
        varchar_types = {'varchar', 'varchar-字符串', 'c', 'string', 'text', 'nvarchar'}
        date_types = {'datetime', 'datetime-日期', 'd', 'date', 'timestamp'}
        num_types = {'int', 'integer', 'n', 'number', 'float', 'real', 'decimal'}
        for group in [varchar_types, date_types, num_types]:
            if t1 in group and t2 in group:
                return True
        return False

    def _detect_transform(self, our_field, vendor_field):
        """检测字段间的格式转换需求"""
        rules = []
        our_remark = (our_field.get('remark') or '') + (our_field.get('description') or '')
        vendor_remark = (vendor_field.get('remark') or '') + (vendor_field.get('description') or '')
        combined = (our_remark + vendor_remark).lower()

        # 日期格式差异
        if 'yyyy-mm-dd' in combined and 'yyyymmdd' in combined:
            rules.append('日期格式: yyyy-MM-dd HH:mm:ss ↔ yyyyMMddHHmmss')
        # 字段名不同但语义相同
        if our_field['field_name'].lower() != vendor_field['field_name'].lower():
            rules.append(f"字段名映射: {our_field['field_name']} → {vendor_field['field_name']}")
        return ' | '.join(rules) if rules else None

    # ========== 第三阶段：执行完整对照 + 存储 ==========

    def run_full_comparison(self, project_id: int, category: str = None) -> dict:
        """一键执行完整对照流程并持久化"""
        matches = self.auto_match_interfaces(project_id, category)
        if not matches:
            return {'comparison_count': 0, 'results': [], 'message': '未找到可对照的接口对'}

        results = []
        summary_stats = {'matched': 0, 'gap': 0, 'transform': 0, 'missing_interface': 0}

        with DatabasePool.get_connection() as conn:
            # 先清除该项目、该分类下的旧对照数据（实现隔离）
            query_old = 'SELECT id FROM interface_comparisons WHERE project_id = ?'
            params_old = [project_id]
            if category:
                query_old += ' AND category = ?'
                params_old.append(category)
            
            old_comps = conn.execute(query_old, params_old).fetchall()
            for oc in old_comps:
                conn.execute('DELETE FROM field_mappings WHERE comparison_id = ?', (oc['id'],))
            
            if category:
                conn.execute('DELETE FROM interface_comparisons WHERE project_id = ? AND category = ?', (project_id, category))
            else:
                conn.execute('DELETE FROM interface_comparisons WHERE project_id = ? AND category IS NULL', (project_id,))

            for match in matches:
                our_id = match['our_spec_id']
                vendor_id = match['vendor_spec_id']

                if our_id is None:
                    # 对方额外接口，不做详细对照
                    continue

                if vendor_id is None:
                    # 我方有、对方无
                    our_spec = conn.execute('SELECT interface_name FROM interface_specs WHERE id = ?', (our_id,)).fetchone()
                    conn.execute('''
                        INSERT INTO interface_comparisons
                        (project_id, our_spec_id, vendor_spec_id, match_type, match_confidence,
                         comparison_result, summary, gap_count, status, category)
                        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'pending', ?)
                    ''', (project_id, our_id, match['match_type'], match['match_confidence'],
                          '{}', match['match_reason'], 1, category))
                    summary_stats['missing_interface'] += 1
                    results.append({
                        'our_interface': our_spec['interface_name'] if our_spec else str(our_id),
                        'vendor_interface': '❌ 对方无此接口',
                        'status': 'missing',
                        'stats': None
                    })
                    continue

                # 执行字段对照
                comp = self.compare_fields(our_id, vendor_id)
                stats = comp['stats']

                cursor = conn.execute('''
                    INSERT INTO interface_comparisons
                    (project_id, our_spec_id, vendor_spec_id, match_type, match_confidence,
                     comparison_result, gap_count, transform_count, status, category)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                ''', (project_id, our_id, vendor_id, match['match_type'],
                      match['match_confidence'],
                      json.dumps({'stats': stats, 'protocol_match': comp['protocol_match']}, ensure_ascii=False),
                      stats['missing_in_vendor'] + stats['type_mismatch'],
                      stats['needs_transform'] + stats['name_different'],
                      category))
                comp_id = cursor.lastrowid

                # 保存字段映射
                for m in comp['mappings']:
                    conn.execute('''
                        INSERT INTO field_mappings
                        (comparison_id, our_field_id, vendor_field_id, our_field_name,
                         vendor_field_name, mapping_status, transform_rule)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    ''', (comp_id, m.get('our_field_id'), m.get('vendor_field_id'),
                          m.get('our_field_name'), m.get('vendor_field_name'),
                          m['mapping_status'], m.get('transform_rule')))

                summary_stats['matched'] += stats['matched']
                summary_stats['gap'] += stats['missing_in_vendor']
                summary_stats['transform'] += stats['needs_transform']

                results.append({
                    'comparison_id': comp_id,
                    'our_interface': comp['our_spec']['name'],
                    'vendor_interface': comp['vendor_spec']['name'],
                    'confidence': match['match_confidence'],
                    'match_reason': match['match_reason'],
                    'stats': stats,
                    'protocol_match': comp['protocol_match'],
                })

            conn.commit()

        # 同步到现有 interfaces 表（让项目概览页也能看到状态）
        self._sync_to_interfaces_table(project_id, results)

        return {
            'comparison_count': len(results),
            'results': results,
            'summary': summary_stats
        }

    def _sync_to_interfaces_table(self, project_id, results):
        """将对照结果同步到现有的 interfaces 表状态"""
        with DatabasePool.get_connection() as conn:
            for r in results:
                if not r.get('stats'):
                    continue
                our_name = r['our_interface']
                s = r['stats']
                if s['missing_in_vendor'] == 0 and s['type_mismatch'] == 0:
                    new_status = '已完成' if s['needs_transform'] == 0 else '开发中'
                    remark = f"接口对照通过 (匹配{s['matched']}字段)"
                else:
                    new_status = '待开发'
                    remark = f"需协调: 缺少{s['missing_in_vendor']}个字段, 类型不匹配{s['type_mismatch']}个"

                conn.execute('''
                    UPDATE interfaces SET status = ?, remark = ?
                    WHERE project_id = ? AND (interface_name LIKE ? OR system_name LIKE ?)
                ''', (new_status, remark, project_id, f'%{our_name}%', f'%{our_name}%'))
            conn.commit()

    # ========== AI 报告生成 ==========

    def generate_ai_report(self, project_id: int) -> str:
        """生成整个项目的接口对照分析报告"""
        with DatabasePool.get_connection() as conn:
            project = dict(conn.execute('SELECT project_name, hospital_name FROM projects WHERE id = ?', (project_id,)).fetchone())
            comps = [dict(c) for c in conn.execute('''
                SELECT ic.*, os.interface_name as our_name, os.system_type,
                       vs.interface_name as vendor_name, vs.vendor_name as vendor_company
                FROM interface_comparisons ic
                LEFT JOIN interface_specs os ON ic.our_spec_id = os.id
                LEFT JOIN interface_specs vs ON ic.vendor_spec_id = vs.id
                WHERE ic.project_id = ?
                ORDER BY ic.gap_count DESC
            ''', (project_id,)).fetchall()]

        if not comps:
            return "暂无对照数据，请先上传接口文档并执行对照。"

        # 构建摘要
        lines = []
        total_gap = 0
        total_transform = 0
        missing_interfaces = 0
        for c in comps:
            gap = c.get('gap_count', 0)
            trans = c.get('transform_count', 0)
            total_gap += gap
            total_transform += trans
            if c.get('vendor_spec_id') is None:
                missing_interfaces += 1
                lines.append(f"- ❌ [{c.get('system_type','')}] {c.get('our_name','')}：对方无此接口")
            elif gap > 0:
                lines.append(f"- ⚠️ [{c.get('system_type','')}] {c.get('our_name','')} ↔ {c.get('vendor_name','')}: 缺{gap}字段, 需转换{trans}字段")
            else:
                lines.append(f"- ✅ [{c.get('system_type','')}] {c.get('our_name','')} ↔ {c.get('vendor_name','')}: 匹配完成")

        detail_text = "\n".join(lines)

        prompt = f"""你是资深医疗信息系统集成架构师。请根据以下接口对照数据，生成面向项目经理和工程师的对接评估报告。

## 项目信息
- 项目: {project['project_name']}
- 医院: {project['hospital_name']}
- 对照接口数: {len(comps)}
- 存在差异的接口: {sum(1 for c in comps if c.get('gap_count',0) > 0)}
- 对方缺失的接口: {missing_interfaces}
- 总计缺失字段: {total_gap}
- 总计需转换字段: {total_transform}

## 各接口对照详情
{detail_text}

---

请输出 Markdown 格式报告，结构如下:
## 📋 总体评估
一段话总结 + 对接难度评分 (⭐1-5星)

## 🔴 关键风险项
只列出最需要关注的问题（缺接口、缺必填字段等）

## 🟡 需要协调确认的事项
列出需要和对方厂商确认的具体问题

## 🟢 可直接对接的部分
哪些接口可以直接开发

## 📝 建议对接方案
给出分步的实施建议"""

        return ai_service.call_ai_api(
            "你是资深医疗信息系统架构师，专精ICU/手麻系统接口集成。",
            prompt, task_type="report"
        ) or "报告生成失败，请稍后重试。"


comparison_service = InterfaceComparisonService()
