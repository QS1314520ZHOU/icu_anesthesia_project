const FormGenerator = {
    init: function () {
        console.log('[FormGenerator] Initialized');
        this.onModeChange();
    },

    onModeChange: function () {
        const mode = document.getElementById('fgMode').value;
        const singleParams = document.getElementById('fgSingleAxisParams');
        const gridParams = document.getElementById('fgGridParams');

        if (mode === 'xy') {
            singleParams.style.display = 'none';
            gridParams.style.display = 'block';
        } else {
            singleParams.style.display = 'block';
            gridParams.style.display = 'none';
        }
    },

    generate: function () {
        const templateText = document.getElementById('fgTemplate').value.trim();
        if (!templateText) {
            showToast('请输入模板 JSON', 'error');
            return;
        }

        const mode = document.getElementById('fgMode').value;
        const prefix = document.getElementById('fgPrefix').value;
        const statusEl = document.getElementById('fgStatus');

        const payload = {
            template_text: templateText,
            mode: mode,
            start_prefix: prefix
        };

        if (mode === 'xy') {
            payload.rows = parseInt(document.getElementById('fgRows').value);
            payload.cols = parseInt(document.getElementById('fgCols').value);
            payload.y_spacing = parseFloat(document.getElementById('fgYSpacing').value);
            payload.x_spacing = parseFloat(document.getElementById('fgXSpacing').value);
        } else {
            payload.count = parseInt(document.getElementById('fgCount').value);
            const spacing = parseFloat(document.getElementById('fgSpacing').value);
            if (mode === 'y') payload.y_spacing = spacing;
            else payload.x_spacing = spacing;
        }

        statusEl.innerText = '正在生成...';

        fetch('/api/form-generator/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    let resultText = data.formatted_text;
                    if (!resultText) {
                        resultText = JSON.stringify(data.data, null, 2);
                        if (data.is_array === false) {
                            resultText = resultText.replace(/^\[\s*/, '').replace(/\s*\]$/, '');
                        }
                    }
                    document.getElementById('fgResult').value = resultText;
                    statusEl.innerText = `生成成功：共 ${data.total_count} 个元素`;
                    showToast('生成成功');
                } else {
                    statusEl.innerText = '生成失败';
                    showToast('生成失败: ' + data.error, 'error');
                }
            })
            .catch(err => {
                console.error(err);
                statusEl.innerText = '网络错误';
                showToast('网络错误', 'error');
            });
    },

    copy: function () {
        const result = document.getElementById('fgResult');
        if (!result.value) return;

        result.select();
        document.execCommand('copy');
        showToast('结果已复制到剪贴板');
    },

    clear: function () {
        if (confirm('确定要清空所有输入吗？')) {
            document.getElementById('fgTemplate').value = '';
            document.getElementById('fgResult').value = '';
            document.getElementById('fgStatus').innerText = '';
        }
    }
};
