// Update current year
document.getElementById("currentYear").textContent = new Date().getFullYear();

// Format bytes to human readable format
function formatBytes(bytes) {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 Byte";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i), 2) + " " + sizes[i];
}

// Format uptime to human readable format
function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

// Fetch server status
async function updateServerStatus() {
  const apiStatusEl = document.getElementById("apiStatus");
  const serverVersionEl = document.getElementById("serverVersion");
  const lastUpdatedEl = document.getElementById("lastUpdated");

  try {
    // Add timestamp to prevent caching
    const response = await fetch(`/api/status?t=${Date.now()}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Update basic status
    apiStatusEl.textContent =
      data.status.charAt(0).toUpperCase() + data.status.slice(1);
    apiStatusEl.className = `status-badge ${data.status}`;

    serverVersionEl.textContent = `v${data.version}`;

    // Update system info if available
    if (data.system) {
      const systemInfo = `Platform: ${data.system.platform}
CPU Cores: ${data.system.cpu.cores}
Memory: ${formatBytes(data.system.memory.used)} / ${formatBytes(
        data.system.memory.total
      )}
Uptime: ${formatUptime(data.uptime)}`;

      const systemInfoPanel = document.getElementById("systemInfoPanel");
      const systemInfoEl = document.getElementById("systemInfo");

      if (systemInfoPanel && systemInfoEl) {
        systemInfoPanel.style.display = "block";
        systemInfoEl.textContent = systemInfo;
      }
    }

    // Update timestamp
    lastUpdatedEl.textContent = new Date(data.timestamp).toLocaleString();
  } catch (error) {
    apiStatusEl.textContent = "Offline";
    apiStatusEl.className = "status-badge error";
    apiStatusEl.title = error.message; // Show error on hover

    serverVersionEl.textContent = "-";
    lastUpdatedEl.textContent = new Date().toLocaleString();

    console.error("Failed to fetch server status:", error);
  }
}

// Initial update
updateServerStatus();

// Update status every minute
setInterval(updateServerStatus, 60000);
