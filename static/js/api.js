
class ApiClient {
    constructor(baseUrl = '/api') {
        this.baseUrl = baseUrl;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
        const defaultHeaders = {};
        const token = localStorage.getItem('token');
        if (token) {
            defaultHeaders['Authorization'] = `Bearer ${token}`;
        }

        // Only set Content-Type to JSON if body is NOT FormData
        if (options.body && !(options.body instanceof FormData)) {
            defaultHeaders['Content-Type'] = 'application/json';
        }

        options.headers = { ...defaultHeaders, ...options.headers };

        try {
            console.log(`[API] ${options.method || 'GET'} ${url}`, options.body ? 'with body' : '');
            const response = await fetch(url, options);

            // Check content type
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                const text = await response.text();
                console.error('API Non-JSON Response:', text);
                throw new Error(`API returned non-JSON response: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            if (data && typeof data === 'object' && 'success' in data) {
                if (data.success) {
                    return data.data !== undefined ? data.data : data;
                } else {
                    const errorMsg = data.message || data.error || 'Unknown API Error';
                    if (!options.silent) {
                        notifyApiError(errorMsg);
                    }
                    throw new Error(errorMsg);
                }
            }

            // Handle legacy/direct response
            if (!response.ok) {
                throw new Error(data.message || data.error || `HTTP Error ${response.status}`);
            }

            return data;
        } catch (error) {
            if (!options.silent) {
                console.error('API Request Failed:', error);
                notifyApiError(error.message || 'Request failed');
            }
            throw error;
        }
    }

    async get(endpoint, options = {}) {
        return this.request(endpoint, { method: 'GET', ...options });
    }

    async post(endpoint, body, options = {}) {
        const isFormData = body instanceof FormData;
        return this.request(endpoint, {
            method: 'POST',
            body: isFormData ? body : JSON.stringify(body),
            ...options
        });
    }

    async put(endpoint, body) {
        const isFormData = body instanceof FormData;
        return this.request(endpoint, {
            method: 'PUT',
            body: isFormData ? body : JSON.stringify(body)
        });
    }

    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
}

function notifyApiError(message) {
    if (typeof showToast === 'function') {
        showToast(message, 'danger');
        return;
    }

    const existing = document.getElementById('apiFallbackToast');
    if (existing) {
        existing.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'apiFallbackToast';
    toast.textContent = message;
    toast.setAttribute('role', 'alert');
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '20px';
    toast.style.zIndex = '9999';
    toast.style.maxWidth = '360px';
    toast.style.padding = '12px 16px';
    toast.style.borderRadius = '10px';
    toast.style.background = '#dc2626';
    toast.style.color = '#fff';
    toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.18)';
    toast.style.fontSize = '14px';
    toast.style.lineHeight = '1.5';
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 4000);
}

const api = new ApiClient();
