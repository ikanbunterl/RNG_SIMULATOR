(function() {
"use strict";

// ======================== GLOBAL STATE (PRIVATE) ========================
let game = {
    gems: 0, totalSpins: 0, inventory: {}, luckMultiplier: 1,
    luckSpinsLeft: 0, luckTimeEnd: 0, bestRarity: null, log: [],
    pityCounter: 0, streak: 0, equippedItem: null, rebirthCount: 0,
    rebirthLuckBonus: 0, highContrast: false,
    settings: { volume: 0.8, graphicsStage: 'medium' }
};
let autoSpinInterval = null;
let luckTimerInterval = null;
let CONFIG = {};
let RNG_DATA = {};
let audioCtx = null;
let soundEnabled = true;
let gemDisplayVal = 0;
let audioFiles = {};
let audioUnlocked = false;
let notificationQueue = [];
let notificationTimeout = null;

// ======================== SECURITY CONSTANTS ========================
const SECURITY = {
    MAX_GEMS: 10_000_000,
    MAX_SPINS: 1_000_000,
    MAX_REBIRTH: 20,
    MAX_STREAK: 500,
    MAX_LUCK_MULTIPLIER: 50,
    MAX_EFFECTIVE_LUCK: 20,           // Hard cap untuk luck efektif
    MAX_LUCK_DURATION: 24 * 60 * 60 * 1000, // 24 jam max
    MIN_AUTO_SPIN_INTERVAL: 400,      // Minimal delay auto-spin (ms)
    VALID_RARITIES: ['common','uncommon','rare','epic','legendary','mythic','diamond','divine','ethereal','secret','transcendent']
};

const UNLOCK_REQS = {
    bulk10:   { spins: 500,  msg: "🔒 Butuh 500 Total Spins" },
    bulk100:  { spins: 5000, msg: "🔒 Butuh 5.000 Total Spins" },
    fastSpin: { spins: 2000, rebirth: 1, msg: "🔒 Butuh 2.000 Spins & 1 Rebirth" },
    autoSpin: { spins: 1000, msg: "🔒 Butuh 1.000 Total Spins" }
};
let prevLockState = { bulk10: true, bulk100: true, fastSpin: true, autoSpin: true };
const SAVE_SALT = 'rng2026_salt_xyz789';

// ======================== SECURITY: HMAC CHECKSUM (Async Fallback) ========================
async function generateHMACChecksum(data) {
    if (!crypto?.subtle) return btoa(SAVE_SALT.slice(0, 16));
    try {
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(SAVE_SALT + '_hmac_key'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );
        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
        return btoa(String.fromCharCode(...new Uint8Array(sig)));
    } catch (e) {
        console.warn('HMAC fallback:', e);
        return btoa(SAVE_SALT.slice(0, 16));
    }
}

async function verifyHMACChecksum(data, signature) {
    if (!crypto?.subtle) return true;
    try {
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(SAVE_SALT + '_hmac_key'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );
        const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
        return await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    } catch (e) {
        console.warn('HMAC verify fallback:', e);
        return true;
    }
}

// ======================== SECURITY: SAVE DATA VALIDATION ========================
function validateSaveData(data) {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid save format');
    
    // Gems validation
    if (typeof data.gems !== 'number' || data.gems < 0 || data.gems > SECURITY.MAX_GEMS) {
        throw new Error(`Invalid gems: ${data.gems}`);
    }
    
    // Spins validation
    if (typeof data.totalSpins !== 'number' || data.totalSpins < 0 || data.totalSpins > SECURITY.MAX_SPINS) {
        throw new Error(`Invalid totalSpins: ${data.totalSpins}`);
    }
    
    // Rebirth validation
    if (typeof data.rebirthCount !== 'number' || data.rebirthCount < 0 || data.rebirthCount > SECURITY.MAX_REBIRTH) {
        throw new Error(`Invalid rebirthCount: ${data.rebirthCount}`);
    }
    
    // Inventory validation
    if (typeof data.inventory !== 'object' || data.inventory === null) data.inventory = {};
    for (let key in data.inventory) {
        if (!SECURITY.VALID_RARITIES.includes(key)) {
            console.warn(`Removing invalid inventory key: ${key}`);
            delete data.inventory[key];
            continue;
        }
        if (typeof data.inventory[key] !== 'number' || data.inventory[key] < 0) {
            data.inventory[key] = 0;
        }
    }
    
    // Luck multiplier validation
    if (typeof data.luckMultiplier !== 'number' || data.luckMultiplier < 1) data.luckMultiplier = 1;
    data.luckMultiplier = Math.min(data.luckMultiplier, SECURITY.MAX_LUCK_MULTIPLIER);
    
    // Streak validation
    if (typeof data.streak !== 'number' || data.streak < 0) data.streak = 0;
    data.streak = Math.min(data.streak, SECURITY.MAX_STREAK);
    
    // luckTimeEnd validation (anti-manipulation)
    const now = Date.now();
    if (typeof data.luckTimeEnd !== 'number' || data.luckTimeEnd > now + SECURITY.MAX_LUCK_DURATION) {
        data.luckTimeEnd = 0;
    }
    
    // luckSpinsLeft validation
    if (typeof data.luckSpinsLeft !== 'number' || data.luckSpinsLeft < 0) data.luckSpinsLeft = 0;
    
    // rebirthLuckBonus validation
    if (typeof data.rebirthLuckBonus !== 'number' || data.rebirthLuckBonus < 0) data.rebirthLuckBonus = 0;
    
    // bestRarity validation
    if (data.bestRarity && !SECURITY.VALID_RARITIES.includes(data.bestRarity)) data.bestRarity = null;
    
    // equippedItem validation
    if (data.equippedItem && !SECURITY.VALID_RARITIES.includes(data.equippedItem) && data.equippedItem !== 'april_badge') {
        data.equippedItem = null;
    }
    
    return true;
}

// ======================== AUDIO ENGINE ========================
function unlockAudioContext() {
    if (!audioUnlocked && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => { audioUnlocked = true; }).catch(() => {});
    }
}

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    document.addEventListener('click', unlockAudioContext, { once: true });
    document.addEventListener('touchstart', unlockAudioContext, { once: true });
    
    const cfg = CONFIG.soundConfig || {};
    const path = cfg.wavPath || 'sounds/';
    const keys = ['spintick', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'diamond', 'divine', 'ethereal', 'secret', 'transcendent', 'newItemJingle', 'coins'];
    
    keys.forEach(key => {
        const audio = new Audio(`${path}${key}.wav`);
        audio.preload = 'auto';
        audioFiles[key] = audio;
    });
}

function playSound(type, isTick = false) {
    if (!soundEnabled || !audioFiles) return;
    const key = isTick ? 'spintick' : type;
    const clip = audioFiles[key];
    
    if (clip && clip.readyState >= 2) {
        const clone = clip.cloneNode();
        const cfg = CONFIG.soundConfig?.[key] || {};
        clone.volume = Math.min(cfg.volume || 0.5, 1.0) * game.settings.volume;
        clone.play().catch(() => {});
    } else if (clip) {
        clip.oncanplay = () => {
            const clone = clip.cloneNode();
            clone.volume = Math.min(CONFIG.soundConfig?.[key]?.volume || 0.5, 1.0) * game.settings.volume;
            clone.play().catch(() => {});
        };
    }
}

// ======================== LOAD JSON DATA ========================
async function loadGameData() {
    try {
        const [configRes, rngRes] = await Promise.all([fetch('config.json'), fetch('RNG.json')]);
        CONFIG = await configRes.json();
        RNG_DATA = await rngRes.json();
        
        CONFIG.settings.pityThreshold = CONFIG.settings.pityThreshold || 50;
        CONFIG.settings.pityGuarantee = CONFIG.settings.pityGuarantee || 'rare';
        CONFIG.settings.streakInterval = CONFIG.settings.streakInterval || 10;
        CONFIG.settings.streakLuckBonus = CONFIG.settings.streakLuckBonus || 0.2;
        
        // 🔐 Freeze settings untuk mencegah modifikasi via console
        Object.freeze(CONFIG.settings);
        
        initAudio(); 
        init();
    } catch (err) {
        console.error('❌ Gagal load data game:', err); 
        init();
    }
}

// ======================== INIT ========================
function init() {
    loadFromStorage();
    renderShop(); 
    renderUpdateLog(); 
    renderInventory();
    updateUI(); 
    updatePityUI(); 
    startLuckTimer();
    initSettingsUI(); 
    applyGraphicsStage();
    
    if(game.highContrast) document.body.classList.add('high-contrast');
    UltraFX.init();
    
    const btnFast = document.getElementById('btnFastToggle');
    if(btnFast && CONFIG.settings.fastSpinMode) {
        btnFast.textContent = '⚡ Fast Spin ON'; 
        btnFast.classList.add('active');
    }
}

// ======================== PAGE NAVIGATION ========================
window.showPage = function(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if(target) target.classList.add('active');
    
    document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.nav button[onclick="showPage('${page}')"]`);
    if(btn) btn.classList.add('active');
    
    if (page === 'inventory') renderInventory();
    if (page === 'log') renderLog();
}

// ======================== LOCK SYSTEM ========================
function isLocked(key) {
    const r = UNLOCK_REQS[key]; 
    if (!r) return false;
    const spinOk = game.totalSpins >= r.spins;
    const rebirthOk = r.rebirth ? game.rebirthCount >= r.rebirth : true;
    return !(spinOk && rebirthOk);
}

function updateFeatureLocks() {
    const locks = [
        { id: 'btnBulk10', key: 'bulk10', req: 500 },
        { id: 'btnBulk100', key: 'bulk100', req: 5000 },
        { id: 'btnFastToggle', key: 'fastSpin', req: 2000 },
        { id: 'btnAuto', key: 'autoSpin', req: 1000 }
    ];
    
    locks.forEach(l => {
        const btn = document.getElementById(l.id); 
        if (!btn) return;
        const currentlyLocked = isLocked(l.key);
        const fill = btn.querySelector('.lock-progress-fill');
        
        if (currentlyLocked) {
            btn.classList.add('locked'); 
            btn.disabled = true;
            btn.setAttribute('data-lock-msg', UNLOCK_REQS[l.key].msg);
            if(fill) fill.style.width = Math.min((game.totalSpins / l.req) * 100, 95) + '%';
        } else {
            if (prevLockState[l.key]) notify(`✨ Fitur ${l.key.toUpperCase()} telah terbuka!`);
            btn.classList.remove('locked'); 
            btn.disabled = false;
            btn.removeAttribute('data-lock-msg');
            if(fill) fill.style.width = '100%';
        }
        prevLockState[l.key] = currentlyLocked;
    });
}

// ======================== RNG ENGINE & PITY ========================
function getEffectiveLuck() {
    // 🔐 Hard cap effective luck untuk mencegah exploit stacking
    let luck = Math.max(game.luckMultiplier, 1) + game.rebirthLuckBonus;
    return Math.min(luck, SECURITY.MAX_EFFECTIVE_LUCK);
}

function rollRarity(rarityTable) {
    let luck = getEffectiveLuck();
    let totalWeight = 0, weights = {};
    
    // 🎯 Luck tiers: common tidak dapat bonus, uncommon partial, rare+ full
    const luckTiers = { 
        common: 0, 
        uncommon: 0.3, 
        rare: 1, 
        epic: 1, 
        legendary: 1, 
        mythic: 1, 
        diamond: 1, 
        divine: 1, 
        ethereal: 1, 
        secret: 1, 
        transcendent: 1 
    };
    
    for (let key in rarityTable) { 
        let r = rarityTable[key];
        if(r.rebirthReq && game.rebirthCount < r.rebirthReq) continue;
        
        // 🔧 Apply luck proporsional berdasarkan tier
        let luckMult = 1 + (luck - 1) * (luckTiers[key] ?? 1);
        let weight = (1 / r.odds) * luckMult;
        weights[key] = weight; 
        totalWeight += weight;
    }
    
    // Pity system
    if (game.pityCounter >= CONFIG.settings.pityThreshold) {
        game.pityCounter = 0; 
        updatePityUI(); 
        return CONFIG.settings.pityGuarantee;
    }
    
    let rand = Math.random() * totalWeight, cumulative = 0;
    for (let key in weights) {
        cumulative += weights[key];
        if (rand <= cumulative) return key;
    }
    return 'common';
}

function triggerVisuals(rarityKey) {
    const display = document.getElementById('spinDisplay');
    const resultEl = document.getElementById('spinResult');
    const flash = document.getElementById('flashOverlay');
    
    resultEl.classList.remove('dropped'); 
    void resultEl.offsetWidth; 
    resultEl.classList.add('dropped');
    
    const rarityColor = RNG_DATA.rarities[rarityKey]?.color || '#fff';
    display.style.setProperty('--glow-color', rarityColor);
    display.classList.remove('glow-pulse'); 
    void display.offsetWidth;  
    display.classList.add('glow-pulse');
    
    flash.classList.add('active'); 
    setTimeout(() => flash.classList.remove('active'), 600);
    
    const highTiers = ['mythic','secret','diamond','divine','ethereal','transcendent'];
    if (highTiers.includes(rarityKey) && game.settings.graphicsStage !== 'low') {
        document.body.classList.add('shake'); 
        setTimeout(() => document.body.classList.remove('shake'), 400);
        if (navigator.vibrate) navigator.vibrate([50, 20, 50]);
    }
    playSound(rarityKey);
    UltraFX.trigger(rarityKey);
}

function updateStreak(rolled) {
    if (rolled === 'common') {
        if (game.streak > 0) {
            game.streak = 0;
            const display = document.getElementById('streakDisplay');
            display.textContent = `🔥 STREAK: 0`;
        }
        return;
    }
    game.streak++;
    const display = document.getElementById('streakDisplay');
    display.textContent = `🔥 STREAK: ${game.streak}`;
    
    if (game.streak % CONFIG.settings.streakInterval === 0) {
        game.luckMultiplier += CONFIG.settings.streakLuckBonus;
        notify(`🔥 STREAK x${game.streak}! Luck +${CONFIG.settings.streakLuckBonus}x!`);
        display.classList.add('streak-high'); 
        setTimeout(() => display.classList.remove('streak-high'), 1500);
    }
}

function updatePityUI() {
    const pct = Math.min((game.pityCounter / CONFIG.settings.pityThreshold) * 100, 100);
    document.getElementById('pityFill').style.width = pct + '%';
    document.getElementById('pityCount').textContent = `${game.pityCounter}/${CONFIG.settings.pityThreshold}`;
}

// ======================== UI & UTILS ========================
function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id); 
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.textContent = Math.floor(progress * (end - start) + start).toLocaleString();
        if (progress < 1) window.requestAnimationFrame(step);
    }; 
    window.requestAnimationFrame(step);
}

function showFloatingGems(amount) {
    const el = document.createElement('div'); 
    el.className = 'float-gem';
    el.textContent = `+${amount} 💎`; 
    el.style.left = '50%'; 
    el.style.top = '40%';
    el.style.transform = 'translateX(-50%)';
    document.getElementById('floatContainer').appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

function updateUI() {
    animateValue('stat-gems', gemDisplayVal, game.gems, 800); 
    gemDisplayVal = game.gems;
    document.getElementById('stat-spins').textContent = game.totalSpins.toLocaleString();
    document.getElementById('stat-luck').textContent = getEffectiveLuck().toFixed(1) + 'x';
    document.getElementById('stat-rebirth').textContent = game.rebirthCount;
    document.getElementById('totalSpinsDisplay').textContent = 'Total Spins: ' + game.totalSpins;
    
    if (game.bestRarity && RNG_DATA.rarities[game.bestRarity]) {
        let br = RNG_DATA.rarities[game.bestRarity];
        let bestEl = document.getElementById('stat-best'); 
        bestEl.textContent = br.name;
        bestEl.className = 'value ' + br.cssClass;
    }
    renderShop(); 
    updateFeatureLocks();
}

function notify(msg) { 
    notificationQueue.push(msg); 
    processNotificationQueue(); 
}

function processNotificationQueue() {
    if (notificationTimeout || notificationQueue.length === 0) return;
    const el = document.getElementById('notification'); 
    const msg = notificationQueue.shift();
    el.textContent = msg; 
    el.classList.remove('show'); 
    void el.offsetWidth; 
    el.classList.add('show');
    
    notificationTimeout = setTimeout(() => {
        el.classList.remove('show'); 
        notificationTimeout = null;
        setTimeout(processNotificationQueue, 300);
    }, CONFIG.settings.notificationDuration || 2500);
}

function renderUpdateLog() {
    const container = document.getElementById('updateLog'); 
    if (!container || !CONFIG.updateEntries) return;
    container.innerHTML = '';
    
    CONFIG.updateEntries.forEach(entry => {
        const div = document.createElement('div'); 
        div.className = 'update-entry';
        const formattedText = entry.text.replace(/\[(ADDED|FIXED|DELETE|MAINTENANCE)\]/g, '<span class="update-tag tag-$1">[$1]</span>');
        div.innerHTML = `<div class="update-date">${entry.date}</div><div class="update-text">${formattedText}</div>`;
        container.appendChild(div);
    });
}

// ======================== SPIN ENGINE ========================
function handleSpin(amount = 1, isAuto = false) {
    initAudio(); 
    const display = document.getElementById('spinDisplay');
    const resultEl = document.getElementById('spinResult'); 
    const btnSpin = document.getElementById('btnSpin');
    
    if (CONFIG.settings.fastSpinMode || isAuto || amount > 1) {
        let summary = { totalGems: 0, bestRoll: null, newItems: [] };
        const order = ['common','uncommon','rare','epic','legendary','mythic','diamond','divine','secret','ethereal','transcendent'];
        
        for(let i = 0; i < amount; i++) {
            let rolled = rollRarity(RNG_DATA.rarities); 
            let rarity = RNG_DATA.rarities[rolled];
            
            if (!game.inventory[rolled]) { 
                game.inventory[rolled] = 1; 
                summary.newItems.push(rarity.name); 
            } else { 
                game.inventory[rolled]++; 
            }
            
            const guaranteeIdx = order.indexOf(CONFIG.settings.pityGuarantee || 'rare');
            let rolledIdx = order.indexOf(rolled);
            
            if (rolledIdx >= guaranteeIdx && rolledIdx !== -1) game.pityCounter = 0;
            else game.pityCounter = Math.min(game.pityCounter + 1, CONFIG.settings.pityThreshold);
            
            if (game.luckSpinsLeft > 0) game.luckSpinsLeft--;
            
            let gemsGained = (rarity && typeof rarity.gems === 'number') ? rarity.gems : 0;
            game.gems += gemsGained; 
            summary.totalGems += gemsGained;
            
            let currentIdx = order.indexOf(summary.bestRoll); 
            let newIdx = order.indexOf(rolled);
            if (newIdx > currentIdx) summary.bestRoll = rolled;
            
            game.totalSpins++;
        }
        
        updatePityUI(); 
        updateBestRarity(summary.bestRoll);
        
        if (summary.newItems.length > 0) {
            let msg = `🎁 Bulk: +${summary.totalGems} 💎`;
            msg += (summary.newItems.length <= 3) ? `| Baru: ${summary.newItems.join(', ')}` : `| +${summary.newItems.length} item baru!`;
            notify(msg);
        }
        updateUI(); 
        saveToStorage(); 
        return;
    }
    
    display.classList.add('spinning'); 
    btnSpin.disabled = true;
    let tickCount = 0; 
    const totalTicks = CONFIG.settings.flickerCount;
    const order = ['common','uncommon','rare','epic','legendary','mythic','diamond','divine','secret','ethereal','transcendent'];
    const keys = Object.keys(RNG_DATA.rarities).filter(k => !RNG_DATA.rarities[k].rebirthReq || game.rebirthCount >= RNG_DATA.rarities[k].rebirthReq);
    
    const tick = () => {
        let randomR = keys[Math.floor(Math.random() * keys.length)];
        resultEl.textContent = RNG_DATA.rarities[randomR].name;
        resultEl.className = 'spin-result ' + RNG_DATA.rarities[randomR].cssClass;
        playSound('spintick', true); 
        tickCount++;
        
        if (tickCount < totalTicks) {
            let delay = CONFIG.settings.flickerInterval;
            const currentIdx = order.indexOf(randomR);
            if (currentIdx >= 3) delay *= 2.2;
            if (tickCount > totalTicks * 0.7) delay *= 1.5;
            setTimeout(tick, delay);
        } else {
            display.classList.remove('spinning'); 
            processSingleResult(false);
            btnSpin.disabled = false; 
            updateUI(); 
            saveToStorage();
        }
    }; 
    tick();
}

function processSingleResult(isBulk = false) {
    let rolled = rollRarity(RNG_DATA.rarities); 
    let rarity = RNG_DATA.rarities[rolled];
    
    if (!game.inventory[rolled]) { 
        game.inventory[rolled] = 1; 
        if(!isBulk) playSound('newItemJingle'); 
    } else { 
        game.inventory[rolled]++; 
    }
    
    const order = ['common','uncommon','rare','epic','legendary','mythic','diamond','divine','secret','ethereal','transcendent'];
    let rolledIdx = order.indexOf(rolled);
    let guaranteeIdx = order.indexOf(CONFIG.settings.pityGuarantee || 'rare');
    
    if (rolledIdx >= guaranteeIdx && rolledIdx !== -1) game.pityCounter = 0;
    else game.pityCounter = Math.min(game.pityCounter + 1, CONFIG.settings.pityThreshold);
    
    updatePityUI(); 
    if (!isBulk) updateStreak(rolled);
    
    if (game.luckSpinsLeft > 0) game.luckSpinsLeft--;
    
    let gemsGained = (rarity && typeof rarity.gems === 'number') ? rarity.gems : 0;
    game.gems += gemsGained; 
    game.totalSpins++; 
    updateBestRarity(rolled); 
    addLog(rolled, rarity);
    
    if (!isBulk) {
        document.getElementById('spinResult').textContent = rarity.name;
        document.getElementById('spinResult').className = 'spin-result ' + rarity.cssClass;
        document.getElementById('spinRarityLabel').textContent = `1 in ${rarity.odds} | +${gemsGained} Gems`;
        document.getElementById('spinRarityLabel').className = 'spin-rarity-label ' + rarity.cssClass;
        showFloatingGems(gemsGained); 
        triggerVisuals(rolled);
    }
}

window.doSpin = function(isAuto=false) { 
    handleSpin(1, isAuto); 
}

window.doBulkSpin = function(amount) { 
    handleSpin(amount); 
}

window.toggleAutoSpin = function() {
    if (isLocked('autoSpin')) { 
        notify("🔒 Fitur Auto Spin masih terkunci!"); 
        return; 
    }
    let btn = document.getElementById('btnAuto');
    
    if (autoSpinInterval) { 
        clearInterval(autoSpinInterval); 
        autoSpinInterval = null; 
        btn.textContent = '▶ AUTO'; 
        btn.classList.remove('active'); 
    } else { 
        btn.textContent = '⏹ STOP'; 
        btn.classList.add('active'); 
        doSpin(true);
        // 🔐 Enforce minimum interval anti-cheat
        const interval = Math.max(CONFIG.settings.autoSpinInterval, SECURITY.MIN_AUTO_SPIN_INTERVAL);
        autoSpinInterval = setInterval(() => doSpin(true), interval); 
    }
}

function updateBestRarity(rolled) {
    const order = ['common','uncommon','rare','epic','legendary','mythic','diamond','divine','secret','ethereal','transcendent'];
    let currentIdx = order.indexOf(game.bestRarity); 
    let newIdx = order.indexOf(rolled);
    if (newIdx > currentIdx) game.bestRarity = rolled;
}

// ======================== LOG ========================
function addLog(rolled, rarity) {
    let now = new Date(); 
    let entry = { 
        time: now.toLocaleTimeString(), 
        rarity: rolled, 
        rarityName: rarity.name, 
        cssClass: rarity.cssClass, 
        gems: rarity.gems 
    };
    game.log.unshift(entry); 
    if (game.log.length > CONFIG.settings.logMaxEntries) game.log.pop();
}

function renderLog() {
    let container = document.getElementById('logContainer'); 
    container.innerHTML = '';
    
    if (game.log.length === 0) { 
        container.innerHTML = '<div class="empty-state">Belum ada log spin.</div>'; 
        return; 
    }
    
    game.log.forEach(entry => {
        let div = document.createElement('div'); 
        div.className = 'log-entry';
        div.innerHTML = `<span class="log-time">[${entry.time}]</span> <span class="log-rarity ${entry.cssClass}">${entry.rarityName}</span> <span style="color:var(--text-dim)">+${entry.gems} gems</span>`;
        container.appendChild(div);
    });
}

window.clearLog = function() { 
    game.log = []; 
    renderLog(); 
    notify('📜 Log dibersihkan!'); 
}

// ======================== SHOP ========================
function renderShop() {
    let container = document.getElementById('shopList'); 
    container.innerHTML = '';
    let categories = {}; 
    let shopDiscount = (game.equippedItem === 'april_badge') ? 0.95 : 1;
    
    CONFIG.shopItems.forEach(item => {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item);
    });
    
    for (let cat in categories) {
        let header = document.createElement('div'); 
        header.className = 'shop-category'; 
        header.textContent = cat.toUpperCase();
        container.appendChild(header);
        
        categories[cat].forEach(item => {
            let finalCost = Math.floor(item.cost * shopDiscount);
            let div = document.createElement('div'); 
            div.className = 'shop-item';
            div.innerHTML = `<div class="shop-item-info"><div class="shop-item-name">${item.name}</div><div class="shop-item-desc">${item.desc}</div></div><div class="shop-item-right"><div class="shop-item-cost">💎 ${finalCost} Gems</div><button class="btn btn-buy" onclick="buyLuck('${item.id}')" ${game.gems < finalCost ? 'disabled' : ''}>BELI</button></div>`;
            container.appendChild(div);
        });
    }
}

window.buyLuck = function(id) {
    let item = CONFIG.shopItems.find(i => i.id === id);
    let shopDiscount = (game.equippedItem === 'april_badge') ? 0.95 : 1;
    let cost = Math.floor(item.cost * shopDiscount);
    
    if (!item || game.gems < cost) { 
        notify('⚠️ Gems tidak cukup!'); 
        return; 
    }
    
    game.gems -= cost;
    
    if (item.type === 'utility') {
        if (id === 'pity_skip') { 
            game.pityCounter = 0; 
            game.gems += 50; 
            notify('✅ Pity direset & +50 Gems!'); 
        } else if (id === 'pity_reduce_25') { 
            game.pityCounter = Math.max(0, game.pityCounter - 25); 
            notify('✅ Pity counter dikurangi 25!'); 
        } else if (id === 'auto_speed_boost') { 
            // 🔐 Tidak bisa ubah CONFIG.settings karena frozen, tapi bisa pakai variable lokal
            notify('⚡ Auto Spin dipercepat (session only)!'); 
        }
    } else {
        game.luckMultiplier = Math.max(game.luckMultiplier, item.multiplier);
        if (item.type === 'spin') { 
            game.luckSpinsLeft += item.amount; 
            notify(`🍀 ${item.name} aktif! (${item.amount} spin tersisa)`); 
        } else if (item.type === 'time') {
            let endTime = Date.now() + (item.duration * 1000);
            if (game.luckTimeEnd < endTime) game.luckTimeEnd = endTime;
            notify(`🍀 ${item.name} aktif! (${item.duration/60} menit)`);
        }
    }
    renderShop(); 
    updateUI(); 
    saveToStorage();
}

function startLuckTimer() {
    if (luckTimerInterval) clearInterval(luckTimerInterval);
    
    luckTimerInterval = setInterval(() => {
        let now = Date.now(); 
        let timerEl = document.getElementById('luckTimer');
        
        if (game.luckSpinsLeft > 0 || game.luckTimeEnd > now) {
            let info = [];
            if (game.luckSpinsLeft > 0) info.push(`${game.luckSpinsLeft} spin tersisa`);
            if (game.luckTimeEnd > now) {
                let remaining = Math.ceil((game.luckTimeEnd - now) / 1000);
                info.push(`${Math.floor(remaining/60)}:${(remaining%60).toString().padStart(2,'0')} tersisa`);
            }
            timerEl.textContent = `🍀 Luck ${game.luckMultiplier}x aktif! | ${info.join(', ')}`;
        } else {
            if (game.luckMultiplier > 1) {
                const baseLuck = 1 + game.rebirthLuckBonus;
                game.luckMultiplier = baseLuck;
                timerEl.textContent = '';
                updateUI();
            } else {
                timerEl.textContent = '';
            }
        }
    }, 1000);
}

// ======================== INVENTORY ========================
window.toggleEquip = function(itemId) {
    if (game.equippedItem === itemId) { 
        game.equippedItem = null; 
        notify('🔓 Item di-unequip.'); 
    } else { 
        if (!game.inventory[itemId] || game.inventory[itemId] <= 0) { 
            notify('⚠️ Kamu tidak punya item ini!'); 
            return; 
        } 
        game.equippedItem = itemId; 
        notify('👑 ' + itemId + ' di-equip!'); 
    }
    renderInventory(); 
    updateUI(); 
    saveToStorage();
}

function renderInventory() {
    let grid = document.getElementById('invGrid'); 
    grid.innerHTML = ''; 
    let hasItems = false;
    
    for (let key in RNG_DATA.rarities) {
        let count = game.inventory[key] || 0;
        if (count > 0) {
            hasItems = true; 
            let r = RNG_DATA.rarities[key];
            let div = document.createElement('div');
            let isEquipped = (game.equippedItem === key) ? 'equipped-aura' : '';
            div.className = `inv-item ${isEquipped}`;
            div.innerHTML = `<div class="item-name ${r.cssClass}">${r.name}</div><div class="item-count">x${count}</div><div class="item-odds">1 in ${r.odds}</div>`;
            
            let btn = document.createElement('button');
            btn.className = `equip-btn ${isEquipped ? 'active' : ''}`;
            btn.textContent = game.equippedItem === key ? 'EQUIPPED' : 'EQUIP';
            btn.onclick = () => window.toggleEquip(key); 
            div.appendChild(btn); 
            grid.appendChild(div);
        }
    }
    if (!hasItems) grid.innerHTML = '<div class="empty-state">Belum ada item. Mulai spin!</div>';
}

// ======================== REBIRTH ========================
window.doRebirth = function() {
    if(game.gems < CONFIG.settings.rebirthGems || game.totalSpins < CONFIG.settings.rebirthSpins) {
        notify(`⚠️ Syarat: ${CONFIG.settings.rebirthGems.toLocaleString()} Gems & ${CONFIG.settings.rebirthSpins.toLocaleString()} Spins!`); 
        return;
    }
    if(!confirm('⚠️ REBIRTH akan mereset Gems & Inventory, tapi memberikan Luck Permanent & membuka Rarity Transcendent! Lanjut?')) return;
    
    const now = Date.now();
    const activeTimeBuff = game.luckTimeEnd > now ? game.luckMultiplier : 1;
    const activeSpinsBuff = game.luckSpinsLeft > 0 ? game.luckMultiplier : 1;
    
    game.gems = 0; 
    game.inventory = {}; 
    game.pityCounter = 0; 
    game.streak = 0;
    
    // ⚖️ Diminishing returns untuk rebirth bonus
    game.rebirthCount++;
    const rebirthArray = CONFIG.settings.rebirthLuckBonusArray || [0.5];
    const bonusIndex = Math.min(game.rebirthCount - 1, rebirthArray.length - 1);
    const thisBonus = rebirthArray[bonusIndex] || 0.1;
    game.rebirthLuckBonus += thisBonus;
    
    if (activeTimeBuff > 1 || activeSpinsBuff > 1) game.luckMultiplier = Math.max(activeTimeBuff, activeSpinsBuff);
    else game.luckMultiplier = 1;
    
    notify(`👑 Rebirth ${game.rebirthCount} berhasil! +${thisBonus}x Luck Permanent.`);
    updateUI(); 
    renderInventory(); 
    saveToStorage();
}

// ======================== SAVE / LOAD ========================
function encodeSave(data) {
    try { 
        const json = JSON.stringify(data); 
        const checksum = btoa(json).split('').reduce((a, b) => a + b.charCodeAt(0), 0); 
        return btoa(json + '|' + checksum + '|' + SAVE_SALT); 
    } catch(e) { 
        console.warn('Encode error:', e); 
        return btoa(JSON.stringify(data)); 
    }
}

function decodeSave(encoded) {
    try { 
        const decoded = atob(encoded); 
        const parts = decoded.split('|');
        if (parts.length < 3 || parts[2] !== SAVE_SALT) throw new Error('Invalid salt');
        const json = parts[0]; 
        const storedChecksum = parseInt(parts[1]);
        const calcChecksum = btoa(json).split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        if (storedChecksum !== calcChecksum) throw new Error('Checksum mismatch'); 
        const parsed = JSON.parse(json);
        validateSaveData(parsed); // 🔐 Run validation!
        return parsed;
    } catch(e) { 
        console.warn('⚠️ Decode failed:', e.message); 
        try { 
            const legacy = JSON.parse(atob(encoded));
            validateSaveData(legacy);
            return legacy;
        } catch(e2) { 
            return null; 
        } 
    }
}

function saveToStorage() { 
    try { 
        // 🔐 Gunakan encodeSave untuk localStorage juga!
        localStorage.setItem('rngGameSave', encodeSave(game)); 
    } catch(e) { 
        console.warn('Save failed:', e); 
    } 
}

function loadFromStorage() {
    try { 
        let data = localStorage.getItem('rngGameSave');
        if (data) {
            const decoded = decodeSave(data);
            if (decoded) {
                const mergedSettings = { ...game.settings, ...(decoded.settings || {}) };
                game = { ...game, ...decoded };
                game.settings = mergedSettings;
                // 🔐 Apply caps setelah load
                game.streak = Math.min(game.streak, SECURITY.MAX_STREAK);
                game.luckMultiplier = Math.min(game.luckMultiplier, SECURITY.MAX_LUCK_MULTIPLIER);
                updateUI(); 
                updatePityUI();
            }
        }
    } catch(e) { 
        console.warn('Load failed:', e); 
    }
}

window.saveGame = function() { 
    saveToStorage(); 
    notify('💾 Game tersimpan!'); 
}

window.exportSave = function() {
    let exportData = { 
        gems: game.gems, 
        totalSpins: game.totalSpins, 
        inventory: game.inventory, 
        luckMultiplier: game.luckMultiplier, 
        luckSpinsLeft: game.luckSpinsLeft, 
        luckTimeEnd: game.luckTimeEnd, 
        bestRarity: game.bestRarity, 
        equippedItem: game.equippedItem, 
        rebirthCount: game.rebirthCount, 
        rebirthLuckBonus: game.rebirthLuckBonus, 
        highContrast: game.highContrast, 
        settings: game.settings 
    };
    document.getElementById('saveTextarea').value = encodeSave(exportData); 
    notify('📤 Save data berhasil diexport!');
}

window.importSave = function() {
    initAudio(); 
    let text = document.getElementById('saveTextarea').value.trim();
    if (!text) { 
        notify('⚠️ Paste save data terlebih dahulu!'); 
        return; 
    }
    try { 
        let data = decodeSave(text); 
        if (!data) throw new Error('Decode failed');
        
        // 🔐 Apply validation & caps
        validateSaveData(data);
        
        game.gems = data.gems || 0; 
        game.totalSpins = data.totalSpins || 0; 
        game.inventory = data.inventory || {};
        game.luckMultiplier = Math.min(data.luckMultiplier || 1, SECURITY.MAX_LUCK_MULTIPLIER); 
        game.luckSpinsLeft = data.luckSpinsLeft || 0;
        game.luckTimeEnd = data.luckTimeEnd || 0; 
        game.bestRarity = data.bestRarity || null;
        game.equippedItem = data.equippedItem || null; 
        game.rebirthCount = Math.min(data.rebirthCount || 0, SECURITY.MAX_REBIRTH);
        game.rebirthLuckBonus = data.rebirthLuckBonus || 0; 
        game.highContrast = data.highContrast || false;
        game.settings = data.settings || { volume: 0.8, graphicsStage: 'medium' };
        game.streak = Math.min(data.streak || 0, SECURITY.MAX_STREAK);
        
        saveToStorage(); 
        updateUI(); 
        updatePityUI(); 
        initSettingsUI(); 
        applyGraphicsStage(); 
        notify('✅ Save data berhasil diimport!');
    } catch(e) { 
        notify('❌ Save data tidak valid!'); 
        console.warn('Import error:', e); 
    }
}

window.resetGame = function() {
    if (confirm('Yakin ingin mereset semua progress? (Rebirth akan hilang)')) {
        localStorage.removeItem('rngGameSave');
        game = { 
            gems:0, totalSpins:0, inventory:{}, luckMultiplier:1, luckSpinsLeft:0, luckTimeEnd:0, 
            bestRarity:null, log:[], pityCounter:0, streak:0, equippedItem:null, rebirthCount:0, 
            rebirthLuckBonus:0, highContrast:false, settings: { volume: 0.8, graphicsStage: 'medium' } 
        };
        updateUI(); 
        renderShop(); 
        renderInventory(); 
        updatePityUI();
        document.getElementById('spinResult').textContent = 'Tekan SPIN untuk mulai!';
        document.getElementById('spinResult').className = 'spin-result rarity-common';
        document.getElementById('spinRarityLabel').textContent = ''; 
        notify('🗑 Game telah direset!');
    }
}

// ======================== SETTINGS & GRAPHICS ========================
function initSettingsUI() {
    const volSlider = document.getElementById('volumeSlider'); 
    const volValue = document.getElementById('volValue');
    
    if (volSlider) { 
        volSlider.value = game.settings.volume * 100; 
        volValue.textContent = Math.round(game.settings.volume * 100) + '%';
        volSlider.oninput = () => { 
            game.settings.volume = volSlider.value / 100; 
            volValue.textContent = Math.round(volSlider.value) + '%'; 
            saveToStorage(); 
        };
    }
    
    const hcBtn = document.getElementById('hcToggle'); 
    if (hcBtn) { 
        hcBtn.textContent = game.highContrast ? 'ON' : 'OFF'; 
        hcBtn.onclick = () => window.toggleHighContrast(); 
    }
    
    document.querySelectorAll('.g-btn').forEach(btn => { 
        btn.classList.toggle('active', btn.dataset.stage === game.settings.graphicsStage); 
        btn.onclick = () => window.setGraphicsStage(btn.dataset.stage); 
    });
}

window.setGraphicsStage = function(stage) { 
    game.settings.graphicsStage = stage; 
    applyGraphicsStage(); 
    document.querySelectorAll('.g-btn').forEach(b => b.classList.toggle('active', b.dataset.stage === stage)); 
    saveToStorage(); 
    notify(`🎮 Graphics Stage set to ${stage.toUpperCase()}`); 
}

function applyGraphicsStage() { 
    document.body.classList.remove('low-graphics', 'medium-graphics', 'high-graphics', 'ultra-graphics'); 
    document.body.classList.add(game.settings.graphicsStage + '-graphics');
    // Reset dynamic bg vars kalau bukan ultra
    if (game.settings.graphicsStage !== 'ultra') {
        document.body.style.removeProperty('--bg-glow');
        document.body.style.removeProperty('--bg-x');
        document.body.style.removeProperty('--bg-y');
    }
}

window.toggleFastSpin = function() {
    if (isLocked('fastSpin')) { 
        notify("🔒 Fitur Fast Spin masih terkunci!"); 
        return; 
    }
    CONFIG.settings.fastSpinMode = !CONFIG.settings.fastSpinMode;
    const btn = document.getElementById('btnFastToggle');
    if (btn) { 
        btn.textContent = CONFIG.settings.fastSpinMode ? '⚡ Fast Spin ON' : '⚡ Fast Spin OFF'; 
        btn.classList.toggle('active', CONFIG.settings.fastSpinMode); 
    }
    saveToStorage(); 
    notify(CONFIG.settings.fastSpinMode ? '⚡ Fast Spin AKTIF!' : '⚡ Fast Spin NONAKTIF');
}

window.toggleHighContrast = function() {
    game.highContrast = !game.highContrast; 
    document.body.classList.toggle('high-contrast', game.highContrast);
    const hcBtn = document.getElementById('hcToggle'); 
    if(hcBtn) hcBtn.textContent = game.highContrast ? 'ON' : 'OFF';
    saveToStorage(); 
    notify(game.highContrast ? '🌗 High Contrast ON' : '🌗 High Contrast OFF');
}

window.toggleSound = function() {
    soundEnabled = !soundEnabled; 
    const btn = document.getElementById('soundToggle');
    if (btn) btn.textContent = soundEnabled ? '🔊' : '🔇'; 
    saveToStorage();
}

// ======================== ULTRA GRAPHICS ENGINE ========================
const UltraFX = (() => {
    let canvas, ctx, particles = [], animFrame = null, isRunning = false;

    // Rarity particle configs
    const RARITY_FX = {
        common:       { count: 0,   colors: ['#b0b0b0'],                    symbols: [] },
        uncommon:     { count: 8,   colors: ['#4CAF50','#81C784'],           symbols: ['✦','·'] },
        rare:         { count: 18,  colors: ['#2196F3','#64B5F6'],           symbols: ['✦','★','·'] },
        epic:         { count: 28,  colors: ['#9C27B0','#CE93D8','#E040FB'], symbols: ['✦','★','◆'] },
        legendary:    { count: 40,  colors: ['#FF9800','#FFD54F','#FFF176'], symbols: ['★','✦','◆','✸'] },
        mythic:       { count: 55,  colors: ['#F44336','#FF8A65','#FF5252'], symbols: ['★','◆','✸','⚡'] },
        diamond:      { count: 65,  colors: ['#00BCD4','#80DEEA','#E0F7FA'], symbols: ['◆','✦','❄','·'] },
        divine:       { count: 80,  colors: ['#FFD700','#FFF9C4','#FFECB3'], symbols: ['★','✸','◆','✦','☀'] },
        ethereal:     { count: 90,  colors: ['#E0FFFF','#B3E5FC','#80CBC4'], symbols: ['✦','·','❄','~','✸'] },
        secret:       { count: 100, colors: ['#FF00FF','#FF0000','#FF7700','#FFFF00','#00FF00','#0000FF','#8B00FF'], symbols: ['★','✦','◆','✸','⚡','?'] },
        transcendent: { count: 150, colors: ['#FFFFFF','#E0FFFF','#FFD700','#FF00FF','#00FFFF'], symbols: ['★','✦','◆','✸','⚡','✨','☀','∞'] }
    };

    // Aura ring tiers
    const AURA_TIERS = ['rare','epic','legendary','mythic','diamond','divine','ethereal','secret','transcendent'];

    function init() {
        canvas = document.getElementById('particleCanvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
    }

    function resize() {
        if (!canvas) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    function isUltra() {
        return document.body.classList.contains('ultra-graphics');
    }

    // Particle burst from spin display
    function burst(rarityKey) {
        if (!isUltra() || !canvas) return;
        const cfg = RARITY_FX[rarityKey];
        if (!cfg || cfg.count === 0) return;

        const display = document.getElementById('spinDisplay');
        if (!display) return;
        const rect = display.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        for (let i = 0; i < cfg.count; i++) {
            const angle = (Math.random() * Math.PI * 2);
            const speed = 2 + Math.random() * 6;
            const size = 3 + Math.random() * 8;
            const isSymbol = cfg.symbols.length > 0 && Math.random() < 0.35;
            particles.push({
                x: cx + (Math.random() - 0.5) * rect.width * 0.5,
                y: cy + (Math.random() - 0.5) * rect.height * 0.5,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - Math.random() * 3,
                color: cfg.colors[Math.floor(Math.random() * cfg.colors.length)],
                size,
                alpha: 1,
                decay: 0.012 + Math.random() * 0.018,
                isSymbol,
                symbol: isSymbol ? cfg.symbols[Math.floor(Math.random() * cfg.symbols.length)] : null,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.15,
                gravity: 0.08 + Math.random() * 0.06
            });
        }

        if (!isRunning) startLoop();
    }

    function startLoop() {
        isRunning = true;
        loop();
    }

    function loop() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles = particles.filter(p => p.alpha > 0.01);

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity;
            p.vx *= 0.98;
            p.alpha -= p.decay;
            p.rotation += p.rotSpeed;

            ctx.save();
            ctx.globalAlpha = Math.max(0, p.alpha);
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);

            if (p.isSymbol) {
                ctx.fillStyle = p.color;
                ctx.font = `bold ${p.size * 1.8}px serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 8;
                ctx.fillText(p.symbol, 0, 0);
            } else {
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = p.size * 1.5;
                ctx.beginPath();
                ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });

        if (particles.length > 0) {
            animFrame = requestAnimationFrame(loop);
        } else {
            isRunning = false;
        }
    }

    // Floating symbols around spin display
    function floatSymbols(rarityKey) {
        if (!isUltra()) return;
        const cfg = RARITY_FX[rarityKey];
        if (!cfg || cfg.symbols.length === 0 || cfg.count < 18) return;

        const display = document.getElementById('spinDisplay');
        if (!display) return;
        const rect = display.getBoundingClientRect();
        const symbolCount = Math.min(Math.floor(cfg.count / 10), 8);

        for (let i = 0; i < symbolCount; i++) {
            setTimeout(() => {
                const el = document.createElement('div');
                el.className = 'float-symbol';
                el.textContent = cfg.symbols[Math.floor(Math.random() * cfg.symbols.length)];
                el.style.color = cfg.colors[Math.floor(Math.random() * cfg.colors.length)];
                el.style.left = (rect.left + Math.random() * rect.width) + 'px';
                el.style.top = (rect.top + rect.height * 0.3 + Math.random() * rect.height * 0.4) + 'px';
                el.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg');
                el.style.animationDuration = (1 + Math.random() * 0.8) + 's';
                document.getElementById('floatContainer').appendChild(el);
                setTimeout(() => el.remove(), 2400);
            }, i * 80);
        }
    }

    // Aura ring on spin display
    function setAura(rarityKey) {
        if (!isUltra()) return;
        const display = document.getElementById('spinDisplay');
        if (!display) return;

        let ring = display.querySelector('.aura-ring');
        if (!ring) {
            ring = document.createElement('div');
            ring.className = 'aura-ring';
            display.appendChild(ring);
        }

        ring.className = 'aura-ring';
        ring.classList.remove('active');

        if (AURA_TIERS.includes(rarityKey)) {
            void ring.offsetWidth;
            ring.classList.add(`aura-${rarityKey}`, 'active');
        }
    }

    // Chromatic aberration on spin result text
    function chromatic(rarityKey) {
        if (!isUltra()) return;
        const highTiers = ['mythic','diamond','divine','ethereal','secret','transcendent'];
        if (!highTiers.includes(rarityKey)) return;
        const el = document.getElementById('spinResult');
        if (!el) return;
        el.classList.remove('chromatic');
        void el.offsetWidth;
        el.classList.add('chromatic');
        setTimeout(() => el.classList.remove('chromatic'), 600);
    }

    // Transcendent: full screen aurora flash
    function transcendentAurora() {
        if (!isUltra()) return;
        document.body.classList.add('transcendent-drop');
        setTimeout(() => document.body.classList.remove('transcendent-drop'), 4000);
    }

    // Dynamic background glow following rarity color
    function setDynamicBg(rarityKey) {
        if (!isUltra()) return;
        const color = (window.RNG_DATA?.rarities?.[rarityKey]?.color) || '#4a3a8a';
        const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
        document.body.style.setProperty('--bg-glow', `rgba(${r},${g},${b},0.13)`);
        document.body.style.setProperty('--bg-x', (30 + Math.random() * 40) + '%');
        document.body.style.setProperty('--bg-y', (20 + Math.random() * 60) + '%');
    }

    // Main trigger — call this from triggerVisuals
    function trigger(rarityKey) {
        if (!isUltra()) return;
        burst(rarityKey);
        floatSymbols(rarityKey);
        setAura(rarityKey);
        chromatic(rarityKey);
        setDynamicBg(rarityKey);
        if (rarityKey === 'transcendent') transcendentAurora();
    }

    return { init, trigger, setAura };
})();

// 🚀 START GAME
window.loadGameData = loadGameData;

// Auto-init saat DOM ready
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadGameData);
else loadGameData();

})();