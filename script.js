// Get Firebase services
const {
    db, collection, doc, setDoc, onSnapshot, 
    updateDoc, arrayUnion, arrayRemove
} = window.firebaseServices;

// --- DOM Elements ---
const groomListContainer = document.getElementById('groom-guests').querySelector('.guest-container');
const brideListContainer = document.getElementById('bride-guests').querySelector('.guest-container');
const tablesContainer = document.getElementById('tables-container');
const masterCounterEl = document.getElementById('master-counter');

// --- Global State ---
let allGuestsData = { groom: [], bride: [] };
let allDropZones;
let currentSeatingConfig = {};

// --- Guest Management ---
document.getElementById('add-groom-guest-button').addEventListener('click', () => addGuest('groom'));
document.getElementById('add-bride-guest-button').addEventListener('click', () => addGuest('bride'));
document.getElementById('groom-guest-input').addEventListener('keyup', (e) => e.key === 'Enter' && addGuest('groom'));
document.getElementById('bride-guest-input').addEventListener('keyup', (e) => e.key === 'Enter' && addGuest('bride'));

async function addGuest(type) {
    const inputEl = document.getElementById(`${type}-guest-input`);
    const guestName = inputEl.value.trim();
    if (guestName) {
        const guestRef = doc(db, 'guests', type);
        await updateDoc(guestRef, { names: arrayUnion(guestName) });
        inputEl.value = '';
    }
}

async function deleteGuest(type, guestName) {
    if (!confirm(`Are you sure you want to remove ${guestName}?`)) return;
    
    const guestRef = doc(db, 'guests', type);
    await updateDoc(guestRef, { names: arrayRemove(guestName) });

    Object.keys(currentSeatingConfig).forEach(zoneId => {
        currentSeatingConfig[zoneId] = currentSeatingConfig[zoneId].filter(name => name !== guestName);
    });
    await saveToFirebase(currentSeatingConfig);
}

// --- Main Appliction ---
function initializeBoard() {
    tablesContainer.innerHTML = '';
    const tableConfigs = [{ id: 'head', name: "d'honneur", capacity: 2 }, ...Array.from({ length: 19 }, (_, i) => ({ id: i + 1, name: i + 1, capacity: 10 }))];
    tableConfigs.forEach(config => {
        const tableDiv = document.createElement('div');
        tableDiv.className = 'table-drop-zone drop-zone';
        tableDiv.id = `table-${config.id}`;
        tableDiv.dataset.capacity = config.capacity;
        tableDiv.innerHTML = `<h3>Table ${config.name}</h3><span class="table-counter">0 / ${config.capacity}</span><div class="table-guests-container"></div>`;
        tablesContainer.appendChild(tableDiv);
    });
    allDropZones = document.querySelectorAll('.drop-zone');
    addDragDropListeners();
}

function renderGuestLists(groomGuests, brideGuests) {
    allGuestsData = { groom: groomGuests, bride: brideGuests };
    groomListContainer.innerHTML = '';
    brideListContainer.innerHTML = '';

    groomGuests.forEach((name, index) => groomListContainer.appendChild(createGuestElement('groom', name, index)));
    brideGuests.forEach((name, index) => brideListContainer.appendChild(createGuestElement('bride', name, index)));
    
    applySeatingPlan();
    updateAllCounters();
}

function customGuestSort(a, b) {
    const isVipA = a === 'Long Vân' || a === 'Manal';
    const isVipB = b === 'Long Vân' || b === 'Manal';

    if (isVipA && !isVipB) return -1;
    if (!isVipA && isVipB) return 1;
    return a.localeCompare(b);
}

function createGuestElement(type, name, index) {
    const guestId = `${type}-guest-${index}`;
    const guestDiv = document.createElement('div');
    guestDiv.className = `guest ${type}`;
    guestDiv.id = guestId;
    guestDiv.draggable = true;
    guestDiv.dataset.name = name;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    guestDiv.appendChild(nameSpan);

    if (name === 'Long Vân' || name === 'Manal') {
        guestDiv.classList.add('vip-guest');
    } else {
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'delete-guest';
        deleteBtn.textContent = '×';
        deleteBtn.onclick = () => deleteGuest(type, name);
        guestDiv.appendChild(deleteBtn);
    }

    return guestDiv;
}

function sortGuestsInContainer(container) {
    const guests = Array.from(container.querySelectorAll('.guest'));
    guests.sort((a, b) => customGuestSort(a.dataset.name, b.dataset.name));
    guests.forEach(guest => container.appendChild(guest));
}

function addDragDropListeners() {
    document.body.addEventListener('dragstart', e => {
        if (e.target.classList.contains('guest')) {
            e.dataTransfer.setData('text/plain', e.target.id);
            setTimeout(() => e.target.classList.add('is-dragging'), 0);
        }
    });
    document.body.addEventListener('dragend', e => {
        if (e.target.classList.contains('guest')) {
            e.target.classList.remove('is-dragging');
        }
    });

    allDropZones.forEach(zone => {
        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const id = e.dataTransfer.getData('text/plain');
            const draggableElement = document.getElementById(id);
            if (!draggableElement) return;

            const isGroomGuest = draggableElement.classList.contains('groom');
            const isBrideGuest = draggableElement.classList.contains('bride');
            if ((zone.id === 'groom-guests' && isBrideGuest) || (zone.id === 'bride-guests' && isGroomGuest)) {
                return;
            }

            let targetContainer;
            if (zone.classList.contains('table-drop-zone')) {
                targetContainer = zone.querySelector('.table-guests-container');
            } else if (zone.classList.contains('guest-list')) {
                targetContainer = zone.querySelector('.guest-container');
            }

            if (targetContainer) {
                targetContainer.appendChild(draggableElement);
                sortGuestsInContainer(targetContainer);
                const newSeatingConfig = buildSeatingConfigFromDOM();
                saveToFirebase(newSeatingConfig);
            }
        });
    });
}

function buildSeatingConfigFromDOM() {
    const seating = {};
    document.querySelectorAll('.drop-zone').forEach(zone => {
        const guestNames = [...zone.querySelectorAll('.guest')].map(g => g.dataset.name);
        seating[zone.id] = guestNames;
    });
    return seating;
}

async function saveToFirebase(seatingConfig) {
    await setDoc(doc(db, "seatingPlans", "currentPlan"), seatingConfig);
}

function applySeatingPlan() {
    const allGuestsMap = new Map();
    document.querySelectorAll('.guest').forEach(guest => allGuestsMap.set(guest.dataset.name, guest));

    Object.keys(currentSeatingConfig).forEach(zoneId => {
        const zoneElement = document.getElementById(zoneId);
        if (zoneElement) {
            let container;
            if (zoneElement.classList.contains('table-drop-zone')) {
                container = zoneElement.querySelector('.table-guests-container');
            } else if (zoneElement.classList.contains('guest-list')) {
                container = zoneElement.querySelector('.guest-container');
            }
            
            if (container) {
                currentSeatingConfig[zoneId].forEach(guestName => {
                    const guestElement = allGuestsMap.get(guestName);
                    if (guestElement) container.appendChild(guestElement);
                });
                sortGuestsInContainer(container);
            }
        }
    });
}

function updateAllCounters() {
    let placedGuestsCount = 0;
    document.querySelectorAll('.table-drop-zone').forEach(table => {
        const guestsInTable = table.querySelector('.table-guests-container').children.length;
        placedGuestsCount += guestsInTable;
        table.querySelector('.table-counter').textContent = `${guestsInTable} / ${table.dataset.capacity}`;
    });
    const totalGuests = allGuestsData.groom.length + allGuestsData.bride.length;
    masterCounterEl.textContent = `${placedGuestsCount} / ${totalGuests}`;
    document.getElementById('groom-list-counter').textContent = `(${groomListContainer.children.length} / ${allGuestsData.groom.length})`;
    document.getElementById('bride-list-counter').textContent = `(${brideListContainer.children.length} / ${allGuestsData.bride.length})`;
}

// --- App Initialization ---
initializeBoard();

onSnapshot(doc(db, "seatingPlans", "currentPlan"), (docSnap) => {
    currentSeatingConfig = docSnap.exists() ? docSnap.data() : {};
    applySeatingPlan();
    updateAllCounters();
});

onSnapshot(doc(db, "guests", "groom"), (docSnap) => {
    const groomNames = docSnap.exists() ? docSnap.data().names.sort(customGuestSort) : [];
    renderGuestLists(groomNames, allGuestsData.bride);
});
onSnapshot(doc(db, "guests", "bride"), (docSnap) => {
    const brideNames = docSnap.exists() ? docSnap.data().names.sort(customGuestSort) : [];
    renderGuestLists(allGuestsData.groom, brideNames);
});