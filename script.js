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
const groomGuestInput = document.getElementById('groom-guest-input');
const brideGuestInput = document.getElementById('bride-guest-input');
const groomCounterEl = document.getElementById('groom-list-counter');
const brideCounterEl = document.getElementById('bride-list-counter');

// --- Global State ---
let allGuestsData = { groom: [], bride: [] };
let currentSeatingConfig = {};

// --- Guest Management ---
document.getElementById('add-groom-guest-button').addEventListener('click', () => addGuest('groom'));
document.getElementById('add-bride-guest-button').addEventListener('click', () => addGuest('bride'));
groomGuestInput.addEventListener('keyup', (e) => e.key === 'Enter' && addGuest('groom'));
brideGuestInput.addEventListener('keyup', (e) => e.key === 'Enter' && addGuest('bride'));

async function addGuest(type) {
    const inputEl = (type === 'groom') ? groomGuestInput : brideGuestInput;
    const guestName = inputEl.value.trim();
    if (guestName) {
        const guestRef = doc(db, 'guests', type);
        try {
            await updateDoc(guestRef, { names: arrayUnion(guestName) });
            inputEl.value = '';
        } catch (error) {
            console.error(`Erreur lors de l'ajout de l'invité (${type}): `, error);
        }
    }
}

async function deleteGuest(type, guestName) {
    if (!confirm(`Voulez-vous supprimer ${guestName} ?`)) return;

    const guestRef = doc(db, 'guests', type);
    try {
        await updateDoc(guestRef, { names: arrayRemove(guestName) });

        // Update seating config to remove the guest
        let seatingUpdated = false;
        const newSeatingConfig = { ...currentSeatingConfig };
        Object.keys(newSeatingConfig).forEach(zoneId => {
            if (newSeatingConfig[zoneId].includes(guestName)) {
                newSeatingConfig[zoneId] = newSeatingConfig[zoneId].filter(name => name !== guestName);
                seatingUpdated = true;
            }
        });
        if (seatingUpdated) {
            await saveToFirebase(newSeatingConfig);
        }
    } catch (error) {
        console.error(`Erreur lors de la suppression de l'invité (${type}): `, error);
    }
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
    
    // Clear existing guest elements from both lists
    groomListContainer.innerHTML = '';
    brideListContainer.innerHTML = '';

    groomGuests.forEach((name) => groomListContainer.appendChild(createGuestElement('groom', name)));
    brideGuests.forEach((name) => brideListContainer.appendChild(createGuestElement('bride', name)));
    
    applySeatingPlan();
    updateAllCounters();
}

function customGuestSort(a, b) {
    // Corrects the "localeCompare is not a function" error
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
    
    // Remove old button if it exists
    const oldButton = guestElement.querySelector('.return-guest-button, .delete-guest-button');
    if (oldButton) oldButton.remove();

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'delete-guest-button';
    deleteBtn.textContent = '−';
    deleteBtn.onclick = () => deleteGuest(guestType, guestName);
    guestElement.appendChild(deleteBtn);
}

function addReturnButton(guestElement) {
    const guestName = guestElement.dataset.name;
    if (guestName === 'Long Vân' || guestName === 'Manal') return;

    // Remove old button if it exists
    const oldButton = guestElement.querySelector('.return-guest-button, .delete-guest-button');
    if (oldButton) oldButton.remove();

    const returnBtn = document.createElement('span');
    returnBtn.className = 'return-guest-button';
    returnBtn.textContent = '×';
    returnBtn.onclick = () => returnGuestToList(guestElement);
    guestElement.appendChild(returnBtn);
}

function returnGuestToList(guestElement) {
    const guestType = guestElement.classList.contains('groom') ? 'groom' : 'bride';
    const targetContainer = guestType === 'groom' ? groomListContainer : brideListContainer;
    targetContainer.appendChild(guestElement);
    
    addDeleteButton(guestElement); // Re-add the correct button
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
            onEnd: function (evt) {
                const destinationZone = evt.to.closest('.drop-zone');
                if (destinationZone) {
                    const movedGuest = evt.item;
                    if (destinationZone.classList.contains('table-drop-zone')) {
                        addReturnButton(movedGuest);
                    } else if (destinationZone.classList.contains('guest-list')) {
                        addDeleteButton(movedGuest);
                        sortGuestsInContainer(evt.to);
                    }
                }
                const newSeatingConfig = buildSeatingConfigFromDOM();
                saveToFirebase(newSeatingConfig);
            },
            onMove: function (evt) {
                const dragged = evt.dragged;
                const targetZone = evt.to.closest('.drop-zone');
                if (!targetZone) return false;
                
                // Prevent VIPs from being moved to the other list
                if (dragged.classList.contains('vip-guest')) {
                    if (targetZone.id === 'groom-guests' && dragged.classList.contains('bride')) return false;
                    if (targetZone.id === 'bride-guests' && dragged.classList.contains('groom')) return false;
                }

                // Prevent moving a guest to a full table
                if (targetZone.classList.contains('table-drop-zone')) {
                    const capacity = parseInt(targetZone.dataset.capacity, 10);
                    const currentGuests = targetZone.querySelectorAll('.guest').length;
                    if (currentGuests >= capacity) {
                        return false;
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
    try {
        await setDoc(doc(db, "seatingPlans", "currentPlan"), seatingConfig);
    } catch (error) {
        console.error("Erreur lors de la sauvegarde de la configuration:", error);
    }
}

function applySeatingPlan() {
    const allGuestsOnPage = new Map();
    document.querySelectorAll('.guest').forEach(guest => allGuestsOnPage.set(guest.dataset.name, guest));

    // Clear all guest containers
    groomListContainer.innerHTML = '';
    brideListContainer.innerHTML = '';
    document.querySelectorAll('.table-guests-container').forEach(container => container.innerHTML = '');

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
                    if (zoneElement.classList.contains('table-drop-zone')) {
                        addReturnButton(guestElement);
                    } else {
                        addDeleteButton(guestElement);
                    }
                    container.appendChild(guestElement);
                }
            });
        }
    });
    sortGuestsInContainer(groomListContainer);
    sortGuestsInContainer(brideListContainer);
    updateAllCounters();
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
    groomCounterEl.textContent = `(${groomListContainer.children.length} / ${allGuestsData.groom.length})`;
    brideCounterEl.textContent = `(${brideListContainer.children.length} / ${allGuestsData.bride.length})`;
}

// --- App Initialization ---
initializeBoard();

onSnapshot(doc(db, "seatingPlans", "currentPlan"), (docSnap) => {
    currentSeatingConfig = docSnap.exists() ? docSnap.data() : {};
    applySeatingPlan();
});

onSnapshot(doc(db, "guests", "groom"), (docSnap) => {
    const groomNames = docSnap.exists() ? docSnap.data().names.sort(customGuestSort) : [];
    allGuestsData.groom = groomNames;
    renderGuestLists(groomNames, allGuestsData.bride);
});

onSnapshot(doc(db, "guests", "bride"), (docSnap) => {
    const brideNames = docSnap.exists() ? docSnap.data().names.sort(customGuestSort) : [];
    allGuestsData.bride = brideNames;
    renderGuestLists(allGuestsData.groom, brideNames);
});
