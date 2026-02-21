
class ApiClient {
    constructor(baseUrl = '/api') {
        this.baseUrl = baseUrl;
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
        const defaultHeaders = {};

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
                    const errorMsg = data.message || 'Unknown API Error';
                    if (!options.silent) alert(errorMsg);
                    throw new Error(errorMsg);
                }
            }

            // Handle legacy/direct response
            if (!response.ok) {
                throw new Error(data.message || `HTTP Error ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('API Request Failed:', error);
            if (!options.silent) {
                alert(error.message || 'Request failed');
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

const api = new ApiClient();
