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
    if (!confirm(`Voulez-vous supprimer ${guestName} ?`)) return;
    
    const guestRef = doc(db, 'guests', type);
    await updateDoc(guestRef, { names: arrayRemove(guestName) });

    Object.keys(currentSeatingConfig).forEach(zoneId => {
        currentSeatingConfig[zoneId] = currentSeatingConfig[zoneId].filter(name => name !== guestName);
    });
    await saveToFirebase(currentSeatingConfig);
}

// --- Main Application ---
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
    initializeDragAndDrop();
}

function renderGuestLists(groomGuests, brideGuests) {
    allGuestsData = { groom: groomGuests, bride: brideGuests };
    document.querySelectorAll('.guest').forEach(guestElement => guestElement.remove());

    groomGuests.forEach((name) => groomListContainer.appendChild(createGuestElement('groom', name)));
    brideGuests.forEach((name) => brideListContainer.appendChild(createGuestElement('bride', name)));
    
    applySeatingPlan();
    updateAllCounters();
}

function customGuestSort(a, b) {

    const nameA = String(a);
    const nameB = String(b);

    const isVipA = nameA === 'Long Vân' || nameA === 'Manal';
    const isVipB = nameB === 'Long Vân' || nameB === 'Manal';

    if (isVipA && !isVipB) return -1;
    if (!isVipA && isVipB) return 1;

    return nameA.localeCompare(nameB);
}

function createGuestElement(type, name) {
    const guestDiv = document.createElement('div');
    guestDiv.className = `guest ${type}`;
    guestDiv.dataset.name = name;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    guestDiv.appendChild(nameSpan);

    if (name === 'Long Vân' || name === 'Manal') {
        guestDiv.classList.add('vip-guest');
    } else {
        addDeleteButton(guestDiv);
    }
    return guestDiv;
}

function addDeleteButton(guestElement) {
    const guestName = guestElement.dataset.name;
    const guestType = guestElement.classList.contains('groom') ? 'groom' : 'bride';
    if (guestName === 'Long Vân' || guestName === 'Manal') return;

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'delete-guest-button';
    deleteBtn.textContent = '−'; // Minus sign for delete
    deleteBtn.onclick = () => deleteGuest(guestType, guestName);
    guestElement.appendChild(deleteBtn);
}

function addReturnButton(guestElement) {
    const returnBtn = document.createElement('span');
    returnBtn.className = 'return-guest-button';
    returnBtn.textContent = '×'; // Cross for return
    returnBtn.onclick = () => returnGuestToList(guestElement);
    guestElement.appendChild(returnBtn);
}

function returnGuestToList(guestElement) {
    const guestType = guestElement.classList.contains('groom') ? 'groom' : 'bride';
    const targetContainer = guestType === 'groom' ? groomListContainer : brideListContainer;
    targetContainer.appendChild(guestElement);
    const oldButton = guestElement.querySelector('.return-guest-button');
    if (oldButton) oldButton.remove();
    addDeleteButton(guestElement);
    sortGuestsInContainer(targetContainer);

    const newSeatingConfig = buildSeatingConfigFromDOM();
    saveToFirebase(newSeatingConfig);
}

function initializeDragAndDrop() {
    const allDropZones = document.querySelectorAll('.guest-container, .table-guests-container');
    allDropZones.forEach(zone => {
        new Sortable(zone, {
            group: 'shared',
            animation: 150,
            delay: 150,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            scroll: true,
            scrollSensitivity: 100,
            scrollSpeed: 20,
            onEnd: function (evt) {
                const destinationZone = evt.to.closest('.drop-zone');

                if (destinationZone && destinationZone.classList.contains('guest-list')) {
                    sortGuestsInContainer(evt.to);
                }
                const newSeatingConfig = buildSeatingConfigFromDOM();
                saveToFirebase(newSeatingConfig);
            },
            onMove: function (evt) {
                const dragged = evt.dragged;
                const targetZone = evt.to.closest('.drop-zone');
                if (!targetZone) return false;
                const isGroomGuest = dragged.classList.contains('groom');
                const isBrideGuest = dragged.classList.contains('bride');
                if ((targetZone.id === 'groom-guests' && isBrideGuest) || (targetZone.id === 'bride-guests' && isGroomGuest)) {
                    return false;
                }
                if (targetZone.classList.contains('table-drop-zone')) {
                    if (evt.from !== evt.to) {
                        const capacity = parseInt(targetZone.dataset.capacity, 10);
                        const currentGuests = targetZone.querySelectorAll('.guest').length;
                        if (currentGuests >= capacity) {
                            return false;
                        }
                    }
                }
                return true;
            }
        });
    });
}

function sortGuestsInContainer(container) {
    const guests = Array.from(container.querySelectorAll('.guest'));
    guests.sort((a, b) => customGuestSort(a.dataset.name, b.dataset.name));
    guests.forEach(guest => container.appendChild(guest));
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
    const allGuestsOnPage = new Map();
    document.querySelectorAll('.guest').forEach(guest => allGuestsOnPage.set(guest.dataset.name, guest));

    Object.keys(currentSeatingConfig).forEach(zoneId => {
        const zoneElement = document.getElementById(zoneId);
        if (!zoneElement) return;

        let container;
        if (zoneElement.classList.contains('table-drop-zone')) {
            container = zoneElement.querySelector('.table-guests-container');
        } else if (zoneElement.classList.contains('guest-list')) {
            container = zoneElement.querySelector('.guest-container');
        }

        if (container) {
            currentSeatingConfig[zoneId].forEach(guestName => {
                const guestElement = allGuestsOnPage.get(guestName);
                if (guestElement) {
                    const oldButton = guestElement.querySelector('.delete-guest-button, .return-guest-button');
                    if (oldButton) oldButton.remove();
                    if (zoneElement.classList.contains('table-drop-zone')) {
                        addReturnButton(guestElement); // Add '×' for guests at tables
                    } else {
                        addDeleteButton(guestElement); // Add '−' for guests in sidebars
                    }
                    container.appendChild(guestElement);
                }
            });
        }
    });
    sortGuestsInContainer(groomListContainer);
    sortGuestsInContainer(brideListContainer);
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
