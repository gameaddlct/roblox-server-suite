const runtime = (typeof browser !== 'undefined') ? browser : chrome;
const saveBtn = document.getElementById('save');

// popup.js
runtime.storage.local.get({ 
    prefSize: 'random', 
    excludeFull: true 
}).then(res => {
    document.getElementById('prefSize').value = res.prefSize;
    document.getElementById('excludeFull').checked = res.excludeFull;
});

saveBtn.addEventListener('click', () => {
    runtime.storage.local.set({
        prefSize: document.getElementById('prefSize').value,
        excludeFull: document.getElementById('excludeFull').checked,
    }).then(() => {
        saveBtn.innerText = "Saved!";
        setTimeout(() => saveBtn.innerText = "Save", 1000);
    });
});
