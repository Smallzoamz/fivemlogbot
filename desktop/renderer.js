let activeTab = 'api';

// ANSI escape code stripper helper
const stripAnsi = (str) => {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
};

// TAB SWITCHING LOGIC
const tabButtons = document.querySelectorAll('.tab-button');
const viewports = document.querySelectorAll('.terminal-viewport');
const prefixText = document.getElementById('current-service-prefix');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active state
    tabButtons.forEach(b => b.classList.remove('active'));
    viewports.forEach(v => v.classList.remove('active'));
    
    // Add active state to selected
    btn.classList.add('active');
    activeTab = btn.getAttribute('data-tab');
    document.getElementById(`viewport-${activeTab}`).classList.add('active');
    
    // Update prefix input indicator
    prefixText.textContent = `${activeTab}:~$`;
    
    // Auto scroll to bottom when switching tabs
    const logList = document.getElementById(`logs-${activeTab}`);
    if (logList) {
      logList.scrollTop = logList.scrollHeight;
    }
  });
});

// LOG STREAM RECEIVER
window.api.onLogUpdate(({ service, data }) => {
  const logList = document.getElementById(`logs-${service}`);
  if (logList) {
    const isAtBottom = logList.scrollTop + logList.clientHeight >= logList.scrollHeight - 60;
    
    // Clean ANSI characters
    const cleanLogs = stripAnsi(data);
    
    const pre = document.createElement('pre');
    pre.className = 'log-line';
    pre.textContent = cleanLogs;
    logList.appendChild(pre);

    // Keep log buffer manageable
    while (logList.childNodes.length > 800) {
      logList.removeChild(logList.firstChild);
    }

    if (isAtBottom) {
      logList.scrollTop = logList.scrollHeight;
    }
  }
});

// PROCESS STATUS INDICATORS
window.api.onStatusUpdate(({ service, status }) => {
  const dot = document.getElementById(`dot-${service}`);
  const card = document.getElementById(`card-${service}`);
  
  if (dot && card) {
    if (status === 'running') {
      dot.className = 'status-dot running';
      card.classList.remove('stopped');
    } else {
      dot.className = 'status-dot stopped';
      card.classList.add('stopped');
    }
  }
});

// SERVICE CONTROLS WIRE UP
const services = ['api', 'bot', 'web'];
services.forEach(service => {
  document.getElementById(`start-${service}`).addEventListener('click', () => {
    window.api.startService(service);
  });
  
  document.getElementById(`stop-${service}`).addEventListener('click', () => {
    window.api.stopService(service);
  });
  
  document.getElementById(`restart-${service}`).addEventListener('click', () => {
    window.api.restartService(service);
  });
});

// INTERACTIVE COMMAND INPUT SENDING (STDIN)
const cmdInput = document.getElementById('cmd-input');
const btnSend = document.getElementById('btn-send-cmd');

const sendCommand = () => {
  const command = cmdInput.value.trim();
  if (command) {
    // Send command to Electron main process
    window.api.sendCommand(activeTab, command);
    
    // Echo command output locally in viewport terminal
    const logList = document.getElementById(`logs-${activeTab}`);
    if (logList) {
      const echo = document.createElement('pre');
      echo.className = 'log-line command-echo';
      echo.textContent = `\n${activeTab}:~$ ${command}\n`;
      logList.appendChild(echo);
      logList.scrollTop = logList.scrollHeight;
    }
    
    cmdInput.value = '';
  }
};

btnSend.addEventListener('click', sendCommand);
cmdInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendCommand();
  }
});

// INITIALIZATION
// Query child process statuses on startup
window.api.queryStatuses();
