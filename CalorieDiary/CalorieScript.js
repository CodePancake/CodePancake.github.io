const CLIENT_ID = '418080642254-32ig7v99an82pgvq8c2tom99k6292jct.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient;
let accessToken = localStorage.getItem('gdrive_access_token') || null;
let driveFileId = localStorage.getItem('gdrive_file_id') || null;

const syncStatusEl = document.getElementById('sync-status');
const syncTextEl = document.getElementById('sync-text');
let statusTimeout;

let diaryData = {};

const datePicker = document.getElementById('diary-date');
const diaryBody = document.getElementById('diary-body');
const totalCalsEl = document.getElementById('total-calories');
const foodForm = document.getElementById('food-form');
const driveBtn = document.getElementById('btn-drive');

const today = new Date().toISOString().split('T')[0];
datePicker.value = today;

// --- GOOGLE IDENTITY INITIALIZATION ---
window.addEventListener('load', () => {
    if (window.google) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: async (response) => {
                if (response.error) {
                    console.error("OAuth Error:", response);
                    return;
                }
                accessToken = response.access_token;
                localStorage.setItem('gdrive_access_token', accessToken);
                updateDriveBtnUI(true);

                if (driveFileId) {
                    await loadFromDrive();
                } else {
                    await saveToDrive();
                }
            },
        });
    }

    if (accessToken) {
        updateDriveBtnUI(true);
        if (driveFileId) loadFromDrive();
    }
    
    render();
});

function updateDriveBtnUI(isConnected) {
    if (!driveBtn) return;
    if (isConnected) {
        driveBtn.textContent = 'Sync Drive';
        driveBtn.classList.add('connected');
    } else {
        driveBtn.textContent = 'Link Drive';
        driveBtn.classList.remove('connected');
    }
}

// --- GOOGLE DRIVE API CALLS ---
if (driveBtn) {
    driveBtn.addEventListener('click', () => {
        if (!accessToken) {
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            saveToDrive();
        }
    });
}

function filterEmptyDates() {
    const filteredData = {};
    for (const [date, items] of Object.entries(diaryData)) {
        if (Array.isArray(items) && items.length > 0) {
            filteredData[date] = items;
        }
    }
    return filteredData;
}

async function saveToDrive() {
    if (!accessToken) return;

    showSyncStatus('Saving to Drive...');

    const content = JSON.stringify(filterEmptyDates(), null, 2);
    const file = new Blob([content], { type: 'application/json' });
    const metadata = {
        name: 'calorie_diary.json',
        mimeType: 'application/json'
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    try {
        let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        let method = 'POST';

        if (driveFileId) {
            url = `https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=multipart`;
            method = 'PATCH';
        }

        const res = await fetch(url, {
            method: method,
            headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
            body: form
        });

        if (res.status === 401) {
            localStorage.removeItem('gdrive_access_token');
            accessToken = null;
            updateDriveBtnUI(false);
            tokenClient.requestAccessToken({ prompt: '' });
            return;
        }

        const data = await res.json();
        if (data.id && !driveFileId) {
            driveFileId = data.id;
            localStorage.setItem('gdrive_file_id', driveFileId);
        }

        showSyncStatus('Synced to Drive ✓', true);
    } catch (err) {
        console.error('Failed to sync to Drive:', err);
        showSyncStatus('Sync Failed ✕', true);
    }
}

async function loadFromDrive() {
    if (!accessToken || !driveFileId) return;

    showSyncStatus('Fetching Drive data...');

    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
            headers: new Headers({ 'Authorization': 'Bearer ' + accessToken })
        });

        if (res.ok) {
            const parsed = await res.json();
            if (typeof parsed === 'object' && parsed !== null) {
                diaryData = parsed;
                render();
            }
        }
        showSyncStatus('Drive Updated ✓', true);
    } catch (err) {
        console.error('Failed to fetch from Drive:', err);
        showSyncStatus('Load Failed ✕', true);
    }
}

// --- CORE RENDER & INTERACTION ---
function render() {
    const currentDate = datePicker.value;
    const entries = diaryData[currentDate] || [];

    diaryBody.innerHTML = '';
    let totalCals = 0;

    if (entries.length === 0) {
        diaryBody.innerHTML = `
            <tr class="empty-row">
                <td colspan="4">No entries for this date. Add food above.</td>
            </tr>`;
    } else {
        entries.forEach((item, index) => {
            totalCals += Number(item.calories);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td>${escapeHtml(item.description || '-')}</td>
                <td class="col-cal">${item.calories}</td>
                <td class="col-action">
                    <button class="btn-danger" onclick="deleteItem(${index})">✕</button>
                </td>
            `;
            diaryBody.appendChild(tr);
        });
    }

    totalCalsEl.textContent = totalCals.toLocaleString();
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, match => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return map[match];
    });
}

foodForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const currentDate = datePicker.value;
    if (!currentDate) return;

    const name = document.getElementById('food-name').value.trim();
    const description = document.getElementById('food-desc').value.trim();
    const calories = parseInt(document.getElementById('food-cals').value, 10);

    if (!diaryData[currentDate]) {
        diaryData[currentDate] = [];
    }

    diaryData[currentDate].push({ name, description, calories });
    foodForm.reset();
    render();
    if (accessToken) saveToDrive();
});

window.deleteItem = function(index) {
    const currentDate = datePicker.value;
    if (diaryData[currentDate]) {
        diaryData[currentDate].splice(index, 1);
        if (diaryData[currentDate].length === 0) {
            delete diaryData[currentDate];
        }
    }
    render();
    if (accessToken) saveToDrive();
};

datePicker.addEventListener('change', render);

// Export JSON
document.getElementById('btn-export').addEventListener('click', () => {
    const filteredData = filterEmptyDates();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `calorie_diary_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});

// Import JSON
const fileInput = document.getElementById('file-input');
document.getElementById('btn-import').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            if (typeof parsed === 'object' && parsed !== null) {
                diaryData = {};
                for (const [date, items] of Object.entries(parsed)) {
                    if (Array.isArray(items) && items.length > 0) {
                        diaryData[date] = items;
                    }
                }
                render();
                if (accessToken) saveToDrive();
            } else {
                alert('Invalid JSON structure.');
            }
        } catch (err) {
            alert('Failed to parse JSON file.');
        }
    };
    reader.readAsText(file);
    fileInput.value = '';
});

// Initial load
render();

// --- SYNC INDICATOR HELPER ---
function showSyncStatus(message, isSuccess = false) {
    if (!syncStatusEl || !syncTextEl) return;
    clearTimeout(statusTimeout);

    syncTextEl.textContent = message;
    
    if (isSuccess) {
        syncStatusEl.classList.add('active', 'success');
        statusTimeout = setTimeout(() => {
            syncStatusEl.classList.remove('active', 'success');
        }, 2000); // Hide badge after 2 seconds on completion
    } else {
        syncStatusEl.classList.remove('success');
        syncStatusEl.classList.add('active');
    }
}