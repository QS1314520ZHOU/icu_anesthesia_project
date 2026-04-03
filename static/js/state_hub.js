// Shared state and constants used across desktop hub modules.

let currentProjectId = null;
let currentProject = null;
let allProjects = [];
let currentActiveTab = 'gantt';
let expandedStages = new Set();
let currentReportProjectId = null;

const STAGE_COLORS = {
    '项目启动': '#5B8FF9', '需求调研': '#5AD8A6', '系统部署': '#F6BD16',
    '表单制作': '#FFBB96', '接口对接': '#E8684A', '设备对接': '#6DC8EC',
    '数据采集': '#9270CA', '系统培训': '#FF9D4D', '试运行': '#269A99', '验收上线': '#5D7092'
};
const STAGE_NAMES = Object.keys(STAGE_COLORS);

const STATUS_COLORS = {
    '待启动': '#9ca3af', '进行中': '#3b82f6', '试运行': '#8b5cf6',
    '验收中': '#f59e0b', '已验收': '#10b981', '质保期': '#06b6d4',
    '暂停': '#f97316', '离场待返': '#ec4899', '已终止': '#ef4444', '已完成': '#22c55e'
};
