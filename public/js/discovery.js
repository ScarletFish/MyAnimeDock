// Discovery view logic
let discoveryData = [];

async function loadDiscovery() {
  try {
    const result = await API.get('/api/refresh');
    discoveryData = [];
    renderDiscovery();
  } catch (e) {
    showToast('扫描失败: ' + e.message);
  }
}

function renderDiscovery() {
  const grid = document.getElementById('discoveryGrid');
  const empty = document.getElementById('discoveryEmpty');

  // Since auto-import is enabled, discovery view shows what was just scanned
  // The library view shows all imported anime
  empty.style.display = 'flex';
  empty.querySelector('p').textContent = '扫描完成，动漫已自动导入到资料库';
  grid.innerHTML = '';
}

function refreshDiscovery() {
  loadDiscovery();
  loadLibrary();
}
