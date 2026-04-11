// Shared UI helpers extracted from main.js and normalized for desktop modules.

function showToast(message, typeOrDuration = 3000, maybeDuration) {
    let type = 'info';
    let duration = 3000;

    if (typeof typeOrDuration === 'number') {
        duration = typeOrDuration;
    } else if (typeof typeOrDuration === 'string') {
        type = typeOrDuration;
        if (typeof maybeDuration === 'number') {
            duration = maybeDuration;
        }
    }

    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            if (container.childNodes.length === 0 && container.parentNode) {
                container.parentNode.removeChild(container);
            }
        }, 300);
    }, duration);
}

function openModal(modalId, options = {}) {
    const el = document.getElementById(modalId);
    if (!el) {
        console.error('[DEBUG] openModal failed: element not found', modalId);
        return;
    }

    const shouldReset = options.reset !== false;
    if (shouldReset) {
        const forms = el.querySelectorAll('form');
        forms.forEach(f => f.reset());
        const textareas = el.querySelectorAll('textarea');
        textareas.forEach(t => t.value = '');
    }

    el.classList.add('show');
    el.style.display = 'flex';
    console.log('[DEBUG] openModal success:', modalId);
}

function showModal(modalId, options = {}) {
    openModal(modalId, options);
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.remove('show');
    el.style.display = 'none';
}

function cleanAiMarkdown(text) {
    if (!text) return '';
    return String(text)
        .replace(/【[^】\n]{0,120}†[^】\n]{0,120}】/g, '')
        .replace(/\[\^\{\{thread-[^\]\n]{0,80}\]?/g, '')
        .replace(/\[\^[^\]\n]{0,120}\]/g, '')
        .replace(/\[\^[^\n]{0,120}$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function renderAiMarkdown(text) {
    const cleaned = cleanAiMarkdown(text);
    if (typeof marked !== 'undefined') {
        return marked.parse(cleaned);
    }
    return cleaned.replace(/\n/g, '<br>');
}

async function writeTextToClipboard(text) {
    const value = String(text ?? '');
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(value);
            return;
        } catch (e) {
            console.warn('[clipboard] navigator.clipboard.writeText failed, fallback to execCommand', e);
        }
    }

    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    input.focus();
    input.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(input);
    if (!copied) {
        throw new Error('当前环境不支持自动复制');
    }
}

async function copyCurrentViewLink() {
    try {
        await writeTextToClipboard(window.location.href);
        showToast('当前视图链接已复制', 'success');
    } catch (e) {
        showToast('复制链接失败: ' + e.message, 'danger');
    }
}

function closeGenericModal() {
    const modal = document.getElementById('askAiModal');
    if (!modal) return;

    const modalTitle = modal.querySelector('h3');
    const inputGroup = modal.querySelector('.input-group');
    const contentDiv = modal.querySelector('#genericModalContent');

    modal.style.display = 'none';
    if (inputGroup) inputGroup.style.display = 'flex';
    if (contentDiv) contentDiv.style.display = 'none';
    if (modalTitle) modalTitle.textContent = '🔮 AI 项目问答';
}

function showGenericModal(title, contentHtml) {
    const modal = document.getElementById('askAiModal');
    if (!modal) {
        showToast(title, 'info', 4000);
        return;
    }

    const modalTitle = modal.querySelector('h3');
    const modalBody = modal.querySelector('.modal-body');
    const inputGroup = modal.querySelector('.input-group');
    const resultDiv = modal.querySelector('#aiQueryResult');

    if (modalTitle) modalTitle.textContent = title;
    if (inputGroup) inputGroup.style.display = 'none';
    if (resultDiv) resultDiv.style.display = 'none';

    let contentDiv = modal.querySelector('#genericModalContent');
    if (!contentDiv) {
        contentDiv = document.createElement('div');
        contentDiv.id = 'genericModalContent';
        modalBody.appendChild(contentDiv);
    }
    contentDiv.innerHTML = contentHtml;
    contentDiv.style.display = 'block';

    modal.style.display = 'block';

    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.onclick = () => {
        closeGenericModal();
    };
}

function enableTabDragging() {
    const tabs = document.querySelector('.tabs');
    if (!tabs) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    tabs.addEventListener('mousedown', (e) => {
        isDown = true;
        startX = e.pageX - tabs.offsetLeft;
        scrollLeft = tabs.scrollLeft;
        tabs.style.cursor = 'grabbing';
    });
    tabs.addEventListener('mouseleave', () => {
        isDown = false;
        tabs.style.cursor = 'grab';
    });
    tabs.addEventListener('mouseup', () => {
        isDown = false;
        tabs.style.cursor = 'grab';
    });
    tabs.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - tabs.offsetLeft;
        const walk = (x - startX) * 2;
        tabs.scrollLeft = scrollLeft - walk;
    });

    tabs.style.cursor = 'grab';
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

async function updateAiHealthUI() {
    const nodeList = document.getElementById('aiNodeList');
    if (!nodeList) return;

    try {
        const info = await api.get('/ai/health', { cacheTtlMs: 15000 });
        nodeList.innerHTML = info.nodes.map(node => `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--gray-600);">${node.name}</span>
                <span style="color:${node.status === 'OK' ? 'var(--success)' : 'var(--danger)'}; font-weight:700;">
                    ${node.status === 'OK' ? '● 在线' : '○ 离线'}
                </span>
            </div>
        `).join('');
    } catch (e) {
        nodeList.innerHTML = '<div style="color:var(--danger); text-align:center;">AI 服务连接失败</div>';
    }
}

async function triggerAiManualHealthCheck(event) {
    const btn = event ? event.currentTarget || event.target : null;
    if (btn) btn.style.animation = 'spin 1s linear infinite';
    await updateAiHealthUI();
    if (btn) setTimeout(() => { btn.style.animation = 'none'; }, 1000);
}

function initStarRatings() {
    document.querySelectorAll('.star-rating').forEach(container => {
        container.innerHTML = '';
        for (let i = 1; i <= 5; i++) {
            const star = document.createElement('span');
            star.className = 'star';
            star.textContent = '★';
            star.dataset.value = i;
            star.onclick = () => setRating(container, i);
            container.appendChild(star);
        }
    });
}

function setRating(container, value) {
    container.dataset.score = value;
    container.querySelectorAll('.star').forEach((star, index) => {
        star.classList.toggle('active', index < value);
    });
}

window.toggleActionDropdown = function (event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('projectActionDropdown');

    document.querySelectorAll('.dropdown-menu.show').forEach(m => {
        if (m !== dropdown) m.classList.remove('show');
    });

    if (dropdown) {
        dropdown.classList.toggle('show');
    }
};

document.addEventListener('click', function () {
    const openWrappers = document.querySelectorAll('.more-wrapper.open');
    if (openWrappers.length > 0) {
        openWrappers.forEach(w => w.classList.remove('open'));
    }
});
