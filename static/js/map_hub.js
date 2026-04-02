(function () {
    window.showDeliveryMap = function () {
        currentProjectId = null;
        hideAllViews();
        document.getElementById('mapView').style.display = 'block';
        if (typeof initDeliveryMap === 'function') {
            initDeliveryMap();
        } else {
            document.getElementById('mapView').innerHTML = '<div class="loading-spinner">加载地图模块中...</div>';
            const script = document.createElement('script');
            script.src = '/api/force_static/js/map.js?v=' + Date.now();
            script.onload = () => initDeliveryMap();
            document.body.appendChild(script);
        }
    };
})();
