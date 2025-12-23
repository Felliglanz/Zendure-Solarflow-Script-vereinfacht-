/************************************************************
 * ZENDURE LADE-/ENTLADELOGIK – ioBroker JavaScript
 * ----------------------------------------------------------
 * Version: 2.01 | Datum: 2025-12-23
 * 
 * Beschreibung:
 *  Vereinfachte Steuerung eines Zendure Solarflow Systems mit 2 Modi,
 *  automatischer Pack-Überwachung und umfassenden
 *  Sicherheitsfunktionen. Pure-Function-Design für Testbarkeit.
 *
 * ----------------------------------------------------------
 * BETRIEBSMODI (2 - VEREINFACHT):
 * ----------------------------------------------------------
 *  1. Sonnenzeit (Auto):
 *     - Tag: Dynamisches Laden mit Netzbezugsgrenze + Sticky Charging
 *     - Nacht: Entladen mit konfigurierbarer Leistung
 *     - SOC=100% → automatisches Tag-Entladen
 *  
 *  2. Manuell-Laden:
 *     - AC-Laden mit max. Leistung bis SOC=100%
 *     - Dann automatischer Standby
 *
 * ----------------------------------------------------------
 * KERNKONZEPTE:
 * ----------------------------------------------------------
 *  • Sticky Charging:
 *    Ladeleistung steigt bei PV-Überschuss, fällt nur wenn
 *    Netzbezug > Zielwert. Verhindert Regelflackern.
 *  
 *  • Hysterese-Schutz:
 *    Flags (akkuLeer, notladenAktiv) mit unterschiedlichen
 *    Ein-/Ausschalt-Schwellen gegen Grenzwert-Flattern.
 *  
 *  • Sanfte Modus-Übergänge:
 *    acMode-Wechsel erst nach 0W-Check (AC/Entladung).
 *    Schont Relais und verhindert Last-Switching.
 *  
 *  • MinVol-Berechnung:
 *    Script berechnet Minimum aus 4 Packs automatisch.
 *    minVol_Schwelle: 3.1V (normal) / 3.2V (Schlechtwetter).
 *  
 *  • Error Recovery:
 *    Nach 5 Fehlversuchen: Script-Stop + Alarm-DP.
 *    Auto-Reset nach 5min fehlerfreiem Betrieb.
 *
 * ----------------------------------------------------------
 * DATENPUNKT-STRUKTUR:
 * ----------------------------------------------------------
 *  0_userdata.0.Zendure/
 *    ├── Status/           (Script schreibt, User liest)
 *    ├── Steuerung/        (User konfiguriert)
 *    ├── Persist/          (Interne Script-Variablen)
 *    └── Werte/            (Berechnete Messwerte)
 *
 * ----------------------------------------------------------
 * SICHERHEITSFUNKTIONEN:
 * ----------------------------------------------------------
 *  ✅ Notladen bei minVol <= 3.0V (Prio über alle Modi)
 *  ✅ Entladestopp bei minVol <= minVol_Schwelle
 *  ✅ Akku-Leer-Flag mit Hysterese (verhindert Flattern)
 *  ✅ Watchdog für eingefrorene Sensordaten
 *  ✅ Eingabe-Validierung mit Range-Checks
 *  ✅ Error Counter mit Auto-Stop/Reset
 *  ✅ Sanfte Übergänge (0W vor Relais-Schaltung)
 *  ✅ Pack-Überwachung mit Fallback
 *
 * ----------------------------------------------------------
 * USAGE:
 * ----------------------------------------------------------
 *  - ioBroker: Script läuft automatisch per schedule
 *  - Simulation: TEST_SIMULATION=true (Entwickler/Debug)
 *  - Logging: LOG_LEVEL (0=ERROR, 1=WARN, 2=INFO, 3=DEBUG)
 ************************************************************/

// ╔══════════════════════════════════════════════════════════════════════╗
// ║                    🔧 USER KONFIGURATION                              ║
// ║  WICHTIG: Diese Werte MÜSSEN an deine Anlage angepasst werden!      ║
// ║  Weitere Einstellungen: ioBroker DPs in 0_userdata.0.Zendure.Steuerung ║
// ╚══════════════════════════════════════════════════════════════════════╝

// 1️⃣ ZENDURE DEVICES
const ZENDURE_ADAPTER = 'zendure-solarflow.0';
const HUB_PRODUCT_ID = '73bkTV';      // HUB1200 Product-ID
const HUB_DEVICE_ID = 'XXXXXXXX';     // HUB1200 Device-ID (ANPASSEN!)
const ACE_PRODUCT_ID = '8bM93H';      // ACE1500 Product-ID
const ACE_DEVICE_ID = 'XXXXXXXX';     // ACE1500 Device-ID (ANPASSEN!)

// 2️⃣ BATTERY PACKS (2-4+ möglich)
// Pack-IDs findest du unter: zendure-solarflow.0.{HUB}.{DEVICE}.packData.{PACK_ID}.minVol
const BATTERY_PACKS = [
    'PACK_ID_1',           // Pack 1 Seriennummer (ANPASSEN!)
    'PACK_ID_2',           // Pack 2 Seriennummer (ANPASSEN!)
    'PACK_ID_3',           // Pack 3 Seriennummer (ANPASSEN!)
    'PACK_ID_4'            // Pack 4 Seriennummer (ANPASSEN!)
];

// 3️⃣ STROMZÄHLER (positiv = Bezug, negativ = Einspeisung)
// Beispiele: Sonoff POWR3, Shelly 3EM, Tasmota
const POWER_METER_DP = 'sonoff.0.Lesekopf.MT691_Power_curr';

// 4️⃣ ASTRO VARIABLEN (werden vom JS-Adapter erstellt)
const ASTRO_SUNRISE_DP = 'javascript.0.variables.astro.sunrise';
const ASTRO_SUNSET_DP = 'javascript.0.variables.astro.sunset';

// 5️⃣ LOGGING & DEBUG
const LOG_LEVEL = 2;          // 0=ERROR, 1=WARN, 2=INFO, 3=DEBUG

// 6️⃣ DISCORD BENACHRICHTIGUNGEN (optional)
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN';
const DISCORD_NOTIFICATIONS_ENABLED = false;  // Master-Schalter: true = aktiv, false = alle deaktiviert

// Welche Benachrichtigungen sollen gesendet werden? (einzeln konfigurierbar)
const DISCORD_NOTIFY = {
    notladen: true,          // ⚠️ Notladen aktiviert (kritische Spannung)
    akkuLeer: true,          // 🔋 Akku-Leer aktiviert (Entladestopp)
    watchdogAlarm: true,     // 🚨 Watchdog-Alarm (Sensor ausgefallen)
    errorCritical: true,     // ❌ Error Counter kritisch (>= 3 Fehler)
    scriptStopped: true      // 🛑 Script gestoppt (max. Fehler erreicht)
};

// Spam-Schutz: Mindestabstand zwischen gleichen Benachrichtigungen (in Minuten)
const DISCORD_SPAM_PROTECTION_MIN = 15;  // Gleiche Meldung max. alle 15 Min

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  ⚠️  AB HIER KEINE ÄNDERUNGEN NÖTIG - Über ioBroker DPs konfigurieren ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ✅ LOGGING SYSTEM
function logError(msg) { log(`❌ ERROR: ${msg}`); }
function logWarn(msg) { if (LOG_LEVEL >= 1) log(`⚠️ WARN: ${msg}`); }
function logInfo(msg) { if (LOG_LEVEL >= 2) log(`ℹ️ INFO: ${msg}`); }
function logDebug(msg) { if (LOG_LEVEL >= 3) log(`🔍 DEBUG: ${msg}`); }

// ✅ DISCORD BENACHRICHTIGUNGEN
// Tracking für Spam-Schutz: Speichert letzte Sendezeit pro Nachrichtentyp
const discordLastSent = {};

/**
 * Sendet eine Benachrichtigung an Discord via Webhook mit Spam-Schutz
 * @param {string} message - Nachrichtentext (kurz und prägnant mit Emoji)
 * @param {string} level - Schweregrad: 'info', 'warn', 'error', 'critical'
 * @param {string} notifyType - Benachrichtigungstyp für Spam-Schutz (z.B. 'notladen', 'akkuLeer')
 */
function sendDiscordNotification(message, level = 'info', notifyType = null) {
    // Master-Schalter prüfen
    if (!DISCORD_NOTIFICATIONS_ENABLED || !DISCORD_WEBHOOK_URL) return;
    
    // Spam-Schutz: Prüfe ob genug Zeit seit letzter gleicher Meldung vergangen ist
    if (notifyType && discordLastSent[notifyType]) {
        const minutesSinceLastSent = (Date.now() - discordLastSent[notifyType]) / 60000;
        if (minutesSinceLastSent < DISCORD_SPAM_PROTECTION_MIN) {
            logDebug(`Discord-Spam-Schutz: ${notifyType} blockiert (${Math.round(minutesSinceLastSent)}min seit letzter Meldung)`);
            return;
        }
    }
    
    try {
        // Farben für Discord Embed (Dezimal)
        const colors = {
            info: 3447003,      // Blau
            warn: 16776960,     // Gelb
            error: 16711680,    // Rot
            critical: 10038562  // Dunkelrot
        };
        
        const color = colors[level] || colors.info;
        
        // Discord Embed erstellen
        const payload = {
            embeds: [{
                title: '🔋 Zendure Solarflow',
                description: message,
                color: color,
                timestamp: new Date().toISOString(),
                footer: {
                    text: `Level: ${level.toUpperCase()}`
                }
            }]
        };
        
        // node-fetch für HTTP POST Request an Discord Webhook (ioBroker-kompatibel)
        const fetch = require('node-fetch');
        
        fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(res => {
            if (res.status === 204) {
                // Erfolgreiche Sendung → Zeitstempel speichern für Spam-Schutz
                if (notifyType) {
                    discordLastSent[notifyType] = Date.now();
                }
                logDebug(`Discord-Benachrichtigung gesendet: ${notifyType || 'unbekannt'}`);
            } else {
                logDebug(`Discord-Response: ${res.status}`);
            }
        }).catch(err => {
            logDebug(`Discord-Fehler: ${err}`);
        });
    } catch (err) {
        logDebug(`Discord-Fehler: ${err}`);
    }
}

/**
 * Sendet beim Script-Start einmal alle Discord-Benachrichtigungstypen als Test
 * Zeigt welche Meldungen möglich sind und prüft ob Discord funktioniert
 */
function sendDiscordStartupTest() {
    if (!DISCORD_NOTIFICATIONS_ENABLED) return;
    
    log('📱 Discord-Startup-Test: Sende alle Benachrichtigungstypen...');
    
    // Alle möglichen Benachrichtigungen einmal durchsenden mit Verzögerung
    // WICHTIG: type=null damit Spam-Schutz NICHT aktiviert wird (echte Alarme sollen danach noch durchgehen)
    const testMessages = [
        { msg: '⚠️ **Notladen aktiviert**\n📊 Netzbezug: 950W | PV: 0W | SOC: 8%', level: 'warn', delay: 0 },
        { msg: '🔋 **Akku-Leer-Schutz aktiviert**\n📉 SOC unter Minimum (10%)\n⏸️ Entladung gestoppt', level: 'warn', delay: 2000 },
        { msg: '🚨 **Watchdog Alarm!**\n⚠️ Keine gültigen Sensordaten seit 5 Minuten\n🛑 Sicherheitsmodus aktiv', level: 'error', delay: 4000 },
        { msg: '❌ **Kritische Fehleranzahl erreicht**\n🔢 Fehler: 5 (Limit: 5)\n🛑 Script wird gestoppt', level: 'error', delay: 6000 },
        { msg: '🛑 **Script gestoppt**\n⚠️ Zu viele Fehler oder Watchdog-Alarm\n🔧 Manuelle Prüfung erforderlich', level: 'critical', delay: 8000 }
    ];
    
    testMessages.forEach(({ msg, level, delay }) => {
        setTimeout(() => {
            sendDiscordNotification(`🧪 **STARTUP-TEST**\n\n${msg}`, level, null);  // type=null → kein Spam-Schutz
        }, delay);
    });
    
    log('✅ Discord-Startup-Test abgeschlossen (Nachrichten werden in 10 Sekunden versendet)');
}

// Fallback stubs für lokale Simulation (Node)
if (typeof log === 'undefined') global.log = (...args) => console.log(...args);
if (typeof existsState === 'undefined') global.existsState = (_id) => false;
if (typeof getState === 'undefined') global.getState = (_id) => ({ val: null });
if (typeof setState === 'undefined') global.setState = (_id, _val) => {};
if (typeof on === 'undefined') global.on = () => {};
if (typeof schedule === 'undefined') global.schedule = (_cron, fn) => { setTimeout(fn, 0); return { stop: () => {} }; };

// ✅ KONSTANTEN
const NOTLADE_INPUT = 900;
const NOTLADE_ACMODE = 1;
const NOTLADE_OUTPUT = 0;
const DEFAULT_MINVOL_NOTLADE = 3.00;
const DEFAULT_MINVOL_ENTLADESTOPP = 3.10;
const MINVOL_HYSTERESE = 0.10;  // Hysterese für Notladen/Entladestopp (100mV Erholung)
const WRITE_THROTTLE_MS = 2000;
const MAX_ERRORS_BEFORE_STOP = 5;
const ERROR_RESET_AFTER_MS = 300000;
const WATCHDOG_INTERVAL_MIN = 10;
const WATCHDOG_HAUSPOWER_MIN = 30;
const WATCHDOG_MINVOL_MIN = 60;
const WATCHDOG_ASTRO_HOURS = 12;
const DEFAULT_WRITE_TOLERANCE_W = 5;   // Standard-Toleranz für Leistungs-Setpoints (±W)

const dpPersist = {
    lastLadeleistung: '0_userdata.0.Zendure.Persist.Last_Ladeleistung',
    notladenAktiv: '0_userdata.0.Zendure.Persist.Notladen_Aktiv',
    errorCounter: '0_userdata.0.Zendure.Persist.Error_Counter',
    lastAcMode: '0_userdata.0.Zendure.Persist.Last_AcMode'
};

// ✅ HELPERS
function safeNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function validateConfig(name, value, min, max, defaultVal) {
    if (!Number.isFinite(value)) {
        logWarn(`${name}: ungültiger Wert '${value}', nutze Default ${defaultVal}`);
        return defaultVal;
    }
    if (value < min || value > max) {
        logWarn(`${name}: ${value} außerhalb [${min}-${max}], nutze Default ${defaultVal}`);
        return defaultVal;
    }
    return value;
}

/**
 * Validiert Betriebsmodus.
 * @param {string} modus - Zu prüfender Modus
 * @returns {string} Validierter Modus oder 'Sonnenzeit'
 */
function validateModus(modus) {
    const validModi = ['Sonnenzeit', 'Manuell-Laden'];
    if (!modus || !validModi.includes(modus)) {
        logWarn(`Ungültiger Modus '${modus}', nutze 'Sonnenzeit'`);
        return 'Sonnenzeit';
    }
    return modus;
}

/**
 * Schreibt State mit ack:true und automatischem Retry bei Fehler.
 * @param {string} id - Datenpunkt-ID
 * @param {*} value - Zu schreibender Wert
 */
function persistState(id, value) {
    try {
        setState(id, { val: value, ack: true });
    } catch (e) {
        // schedule a retry
        setTimeout(() => {
            try { setState(id, { val: value, ack: true }); } catch (e2) { logDebug(`persistState failed for ${id}`); }
        }, 1000);
    }
}

// ----------------------------------------------------------
// ✅ KONFIGURATION
// ----------------------------------------------------------
// DEFAULT-Werte (werden durch Steuerungs-DPs überschrieben)
const DEFAULT_NETZBEZUG_ZIEL_LADEN = 100;        // Für Sonnenzeit/Manuell-Laden
const DEFAULT_MAX_LADELEISTUNG = 900;
const LADESTUFEN = [100, 200, 300, 400, 500, 600, 700, 800, 900];  // Device-Steps

const DEFAULT_ENTLADELEISTUNG_NACHT = 1000;
const DEFAULT_ENTLADELEISTUNG_TAG = 1000;

const DEFAULT_SUNRISE_OFFSET_MIN = 0;
const DEFAULT_SUNSET_OFFSET_MIN = 0;


// ----------------------------------------------------------
// ✅ DATENPUNKTE (aus User-Config generiert)
// ----------------------------------------------------------
// Basis-Pfade aus User-Config
const ZENDURE_BASE = `${ZENDURE_ADAPTER}.${HUB_PRODUCT_ID}.${HUB_DEVICE_ID}`;
const ZENDURE_PACK_BASE = `${ZENDURE_BASE}.packData`;

// Dynamisch Pack-DPs aus BATTERY_PACKS Array erzeugen
const packDPs = {};
BATTERY_PACKS.forEach((packId, index) => {
    if (packId && packId.trim() !== '') {
        packDPs[`pack${index + 1}MinVol`] = `${ZENDURE_PACK_BASE}.${packId}.minVol`;
    }
});

const dp = {
    // Sensoren
    hausPower: POWER_METER_DP,
    soc: `${ZENDURE_BASE}.electricLevel`,

    // MinVol (berechnet vom Script)
    minVol: '0_userdata.0.Zendure.Werte.minVol',
    minVol_Schwelle: '0_userdata.0.Zendure.Werte.minVol_Schwelle',

    // Pack minVol Werte (dynamisch aus BATTERY_PACKS generiert)
    ...packDPs,

    // Device Status
    acMode: `${ZENDURE_BASE}.acMode`,
    inputLimit: `${ZENDURE_BASE}.inputLimit`,
    outputLimit: `${ZENDURE_BASE}.outputLimit`,
    smartMode: `${ZENDURE_BASE}.smartMode`,
    
    // Aktuelle Leistungen
    ladeleistungAktuell: `${ZENDURE_BASE}.outputPackPower`,
    entladeleistungAktuell: `${ZENDURE_BASE}.packInputPower`,
    acEingangAktuell: `${ZENDURE_ADAPTER}.${ACE_PRODUCT_ID}.${ACE_DEVICE_ID}.gridInputPower`,

    // Steuerung
    setAcMode: `${ZENDURE_BASE}.control.acMode`,
    setInputLimit: `${ZENDURE_BASE}.control.setInputLimit`,
    setOutputLimit: `${ZENDURE_BASE}.control.setOutputLimit`,
    setSmartMode: `${ZENDURE_BASE}.control.smartMode`,

    // Astro
    sunrise: ASTRO_SUNRISE_DP,
    sunset: ASTRO_SUNSET_DP,
};

// Status-DP für AkkuLeer und AkkuVoll Tag
const dpAkkuLeer = '0_userdata.0.Zendure.Status.Akku_Leer';
const dpAkkuVollTag = '0_userdata.0.Zendure.Status.Akku_Voll_Tag';
const dpModusAktuell = '0_userdata.0.Zendure.Status.Modus_Aktuell';
const dpWatchdogAlarm = '0_userdata.0.Zendure.Status.Watchdog_Alarm';
const dpModusWechselAktiv = '0_userdata.0.Zendure.Status.Modus_Wechsel_Aktiv';

// Steuerungs-Datenpunkte (externe Konfiguration)
const dpSteuerung = {
    modus: '0_userdata.0.Zendure.Steuerung.Modus',
    stop: '0_userdata.0.Zendure.Steuerung.Stop',
    netzbezugZielLaden: '0_userdata.0.Zendure.Steuerung.Netzbezug_Ziel_Laden',
    maxLadeleistung: '0_userdata.0.Zendure.Steuerung.Max_Ladeleistung',
    entladeleistungTag: '0_userdata.0.Zendure.Steuerung.Entladeleistung_Tag',
    entladeleistungNacht: '0_userdata.0.Zendure.Steuerung.Entladeleistung_Nacht',
    sunriseOffset: '0_userdata.0.Zendure.Steuerung.Sunrise_Offset_Min',
    sunsetOffset: '0_userdata.0.Zendure.Steuerung.Sunset_Offset_Min',
    stickyChargingAktiv: '0_userdata.0.Zendure.Steuerung.Sticky_Charging_Aktiv',
    tagEntladenBei100Aktiv: '0_userdata.0.Zendure.Steuerung.Tag_Entladen_Bei_100_Aktiv',
    schlechtWetter: '0_userdata.0.Zendure.Steuerung.Schlecht_Wetter',
    minVolNotlade: '0_userdata.0.Zendure.Steuerung.MinVol_Notlade_Schwelle',
    minVolNotladeSchlecht: '0_userdata.0.Zendure.Steuerung.MinVol_Notlade_Schwelle_Schlecht',
    minVolEntladestopp: '0_userdata.0.Zendure.Steuerung.MinVol_Entladestopp_Schwelle',
    minVolEntladestoppSchlecht: '0_userdata.0.Zendure.Steuerung.MinVol_Entladestopp_Schwelle_Schlecht',
    writeToleranceW: '0_userdata.0.Zendure.Steuerung.Write_Toleranz_Watt'
};


// ----------------------------------------------------------
// ✅ Userdata States initialisieren (vor allen anderen Funktionen!)
// ----------------------------------------------------------
(function initUserDataStates() {
    const userDataStates = [
        // Status-DPs
        { id: dpAkkuLeer, type: 'boolean', name: 'Akku Leer Flag', def: false, role: 'indicator' },
        { id: dpAkkuVollTag, type: 'boolean', name: 'Akku Voll am Tag', def: false, role: 'indicator' },
        { id: dpModusAktuell, type: 'string', name: 'Aktueller Betriebsmodus', def: 'Initialisierung', role: 'text' },
        { id: dpWatchdogAlarm, type: 'string', name: 'Watchdog Alarm Details', def: '', role: 'text' },
        { id: dpModusWechselAktiv, type: 'boolean', name: 'Modus-Wechsel aktiv', def: false, role: 'indicator' },
        { id: dpPersist.lastLadeleistung, type: 'number', name: 'Letzte Ladeleistung', def: 0, unit: 'W', role: 'value.power' },
        { id: dpPersist.notladenAktiv, type: 'boolean', name: 'Notladen aktiv', def: false, role: 'indicator' },
        { id: dpPersist.errorCounter, type: 'number', name: 'Error Counter', def: 0, role: 'value' },
        { id: dpPersist.lastAcMode, type: 'number', name: 'Letzter acMode', def: 1, role: 'value' },
        { id: dp.minVol, type: 'number', name: 'Minimale Zellspannung (berechnet)', def: 3.5, unit: 'V', role: 'value.voltage' },
        { id: dp.minVol_Schwelle, type: 'number', name: 'MinVol Schwellwert', def: 3.1, unit: 'V', role: 'value.voltage' },
        
        // Steuerungs-DPs
        { id: dpSteuerung.modus, type: 'string', name: 'Betriebsmodus', def: 'Sonnenzeit', role: 'text', 
          desc: 'Modi: Sonnenzeit, Manuell-Laden',
          states: { 'Sonnenzeit': 'Sonnenzeit', 'Manuell-Laden': 'Manuell-Laden' } },
        { id: dpSteuerung.stop, type: 'boolean', name: 'Script Stop', def: false, role: 'switch' },
        { id: dpSteuerung.netzbezugZielLaden, type: 'number', name: 'Netzbezug Ziel (Laden)', def: DEFAULT_NETZBEZUG_ZIEL_LADEN, unit: 'W', role: 'value.power',
          desc: 'Ziel-Netzbezug für Lade-Modi (Sonnenzeit, Manuell-Laden)' },
        { id: dpSteuerung.maxLadeleistung, type: 'number', name: 'Max Ladeleistung', def: DEFAULT_MAX_LADELEISTUNG, unit: 'W', role: 'value.power',
          states: { '100': '100W', '200': '200W', '300': '300W', '400': '400W', '500': '500W', '600': '600W', '700': '700W', '800': '800W', '900': '900W', '1000': '1000W', '1100': '1100W', '1200': '1200W' } },
        { id: dpSteuerung.entladeleistungTag, type: 'number', name: 'Entladeleistung Tag', def: DEFAULT_ENTLADELEISTUNG_TAG, unit: 'W', role: 'value.power',
          states: { '0': '0W (Aus)', '100': '100W', '200': '200W', '300': '300W', '400': '400W', '500': '500W', '600': '600W', '700': '700W', '800': '800W', '900': '900W', '1000': '1000W', '1100': '1100W', '1200': '1200W' } },
        { id: dpSteuerung.entladeleistungNacht, type: 'number', name: 'Entladeleistung Nacht', def: DEFAULT_ENTLADELEISTUNG_NACHT, unit: 'W', role: 'value.power',
          states: { '0': '0W (Aus)', '100': '100W', '200': '200W', '300': '300W', '400': '400W', '500': '500W', '600': '600W', '700': '700W', '800': '800W', '900': '900W', '1000': '1000W', '1100': '1100W', '1200': '1200W' } },
        { id: dpSteuerung.sunriseOffset, type: 'number', name: 'Sunrise Offset', def: DEFAULT_SUNRISE_OFFSET_MIN, unit: 'min', role: 'value',
          states: { '-120': '-120min', '-90': '-90min', '-60': '-60min', '-30': '-30min', '0': '±0min', '30': '+30min', '60': '+60min', '90': '+90min', '120': '+120min' } },
        { id: dpSteuerung.sunsetOffset, type: 'number', name: 'Sunset Offset', def: DEFAULT_SUNSET_OFFSET_MIN, unit: 'min', role: 'value',
          states: { '-120': '-120min', '-90': '-90min', '-60': '-60min', '-30': '-30min', '0': '±0min', '30': '+30min', '60': '+60min', '90': '+90min', '120': '+120min' } },
        { id: dpSteuerung.stickyChargingAktiv, type: 'boolean', name: 'Sticky Charging aktiv', def: true, role: 'switch' },
        { id: dpSteuerung.tagEntladenBei100Aktiv, type: 'boolean', name: 'Tag-Entladen bei 100% aktiv', def: true, role: 'switch' },
        { id: dpSteuerung.schlechtWetter, type: 'boolean', name: 'Schlechtwetter-Modus', def: false, role: 'switch',
          desc: 'Aktiviert höhere Schutz-Schwellwerte (z.B. bei Kälte/Regen). Kann automatisch per Forecast-Script gesetzt werden' },
        { id: dpSteuerung.minVolNotlade, type: 'number', name: 'MinVol Notlade-Schwelle (Normal)', def: DEFAULT_MINVOL_NOTLADE, unit: 'V', role: 'value',
          desc: 'Notladen startet bei minVol ≤ diesem Wert bei normalem Wetter (2.90V-3.10V)',
          states: { '2.90': '2.90V', '2.95': '2.95V', '3.00': '3.00V (Standard)', '3.05': '3.05V', '3.10': '3.10V' } },
        { id: dpSteuerung.minVolNotladeSchlecht, type: 'number', name: 'MinVol Notlade-Schwelle (Schlechtwetter)', def: 3.05, unit: 'V', role: 'value',
          desc: 'Notladen startet bei minVol ≤ diesem Wert bei Schlechtwetter (2.95V-3.15V)',
          states: { '2.95': '2.95V', '3.00': '3.00V', '3.05': '3.05V (Standard)', '3.10': '3.10V', '3.15': '3.15V' } },
        { id: dpSteuerung.minVolEntladestopp, type: 'number', name: 'MinVol Entladestopp-Schwelle (Normal)', def: DEFAULT_MINVOL_ENTLADESTOPP, unit: 'V', role: 'value',
          desc: 'Entladen stoppt bei minVol ≤ diesem Wert bei normalem Wetter (3.00V-3.30V)',
          states: { '3.00': '3.00V', '3.05': '3.05V', '3.10': '3.10V (Standard)', '3.15': '3.15V', '3.20': '3.20V', '3.25': '3.25V', '3.30': '3.30V' } },
                { id: dpSteuerung.minVolEntladestoppSchlecht, type: 'number', name: 'MinVol Entladestopp-Schwelle (Schlechtwetter)', def: 3.20, unit: 'V', role: 'value',
                    desc: 'Entladen stoppt bei minVol ≤ diesem Wert bei Schlechtwetter (3.10V-3.40V)',
                    states: { '3.10': '3.10V', '3.15': '3.15V', '3.20': '3.20V (Standard)', '3.25': '3.25V', '3.30': '3.30V', '3.35': '3.35V', '3.40': '3.40V' } },
                { id: dpSteuerung.writeToleranceW, type: 'number', name: 'Schreib-Toleranz (±W)', def: DEFAULT_WRITE_TOLERANCE_W, unit: 'W', role: 'value',
                    desc: 'Unterhalb dieser Toleranz werden setInputLimit/setOutputLimit nicht erneut geschrieben (0=aus). Empfohlen: 5-20W',
                    states: { '0': '0W (deaktiviert)', '5': '±5W (empfohlen)', '10': '±10W', '15': '±15W', '20': '±20W', '30': '±30W', '50': '±50W' } }
    ];

    userDataStates.forEach(state => {
        if (!existsState(state.id)) {
            const stateConfig = {
                name: state.name,
                type: state.type,
                read: true,
                write: true,
                role: state.role,
                unit: state.unit || ''
            };
            
            // Dropdown-Optionen hinzufügen falls definiert
            if (state.states) {
                stateConfig.states = state.states;
            }
            
            createState(state.id, state.def, stateConfig);
            log(`✅ Userdata-DP erstellt: ${state.id}`);
        }
    });
})();

// ----------------------------------------------------------
// ✅ Hilfsfunktionen
/**
 * Schreibt State nur bei Änderung mit Rate-Limiting, Retry und ack-Logik.
 * Control-DPs (setXXX) → ack:false, Status/Persist-DPs → ack:true.
 * @param {string} id - Datenpunkt-ID
 * @param {*} value - Neuer Wert
 */
function setIfChanged(id, value) {
    // Effektive Toleranz dynamisch aus DP lesen (0-100W, Default 5W)
    let WRITE_TOLERANCE_W = DEFAULT_WRITE_TOLERANCE_W;
    try {
        const cfgTol = validateConfig('Write_Toleranz_Watt',
            safeNumber(getState(dpSteuerung.writeToleranceW).val), 0, 100, DEFAULT_WRITE_TOLERANCE_W);
        WRITE_TOLERANCE_W = cfgTol;
    } catch (e) { /* fallback auf Default */ }

    // Duplicate Action Prevention: für Control-DPs gegen Gerätestates prüfen
    try {
        const controlIds = [dp.setAcMode, dp.setInputLimit, dp.setOutputLimit, dp.setSmartMode];
        if (controlIds.includes(id)) {
            // Gerätestatus lesen
            if (id === dp.setInputLimit) {
                const cur = Number(getState(dp.inputLimit).val);
                const tgt = Number(value);
                if (Number.isFinite(cur) && Number.isFinite(tgt) && Math.abs(cur - tgt) <= WRITE_TOLERANCE_W) {
                    logDebug(`⏭️ Skip setInputLimit: bereits ~${cur}W (±${WRITE_TOLERANCE_W}W)`);
                    return;
                }
            } else if (id === dp.setOutputLimit) {
                const cur = Number(getState(dp.outputLimit).val);
                const tgt = Number(value);
                if (Number.isFinite(cur) && Number.isFinite(tgt) && Math.abs(cur - tgt) <= WRITE_TOLERANCE_W) {
                    logDebug(`⏭️ Skip setOutputLimit: bereits ~${cur}W (±${WRITE_TOLERANCE_W}W)`);
                    return;
                }
            } else if (id === dp.setAcMode) {
                const curMode = getState(dp.acMode).val;
                if (curMode === value) {
                    logDebug(`⏭️ Skip setAcMode: bereits ${value}`);
                    return;
                }
            } else if (id === dp.setSmartMode) {
                const cur = !!getState(dp.smartMode).val;
                const tgt = !!value;
                if (cur === tgt) {
                    logDebug(`⏭️ Skip setSmartMode: bereits ${tgt}`);
                    return;
                }
            }
        }
    } catch (e) { /* fallback auf Standardlogik */ }

    const old = getState(id).val;
    if (old !== value) {
        const now = Date.now();
        // rate-limit writes to the same DP
        if (!setIfChanged._last || !setIfChanged._last[id] || now - setIfChanged._last[id] > WRITE_THROTTLE_MS) {
            try {
                // decide ack: control commands => ack:false, status/persist => ack:true
                const controlIds = [dp.setAcMode, dp.setInputLimit, dp.setOutputLimit, dp.setSmartMode];
                const statusIds = [
                    dp.minVol_Schwelle, 
                    dpAkkuLeer, 
                    dpAkkuVollTag, 
                    dpModusAktuell, 
                    dpWatchdogAlarm, 
                    dpModusWechselAktiv,
                    dpPersist.lastLadeleistung, 
                    dpPersist.notladenAktiv,
                    dpPersist.errorCounter,
                    dpPersist.lastAcMode
                ];
                const steuerungIds = Object.values(dpSteuerung);
                const isControl = controlIds.includes(id);
                const isStatus = statusIds.includes(id);
                const ack = isControl ? false : (isStatus ? true : false);
                setState(id, { val: value, ack: ack });
                setIfChanged._last = setIfChanged._last || {};
                setIfChanged._last[id] = now;
                logDebug(`🔄 ${id} geändert: ${old} → ${value}`);
                // Error Counter zurücksetzen bei Erfolg
                if (errorCounter > 0) {
                    errorCounter = 0;
                    persistState(dpPersist.errorCounter, 0);
                }
            } catch (err) {
                // Error Counter erhöhen
                errorCounter++;
                lastErrorTime = now;
                persistState(dpPersist.errorCounter, errorCounter);
                logWarn(`setState-Fehler #${errorCounter} für ${id}: ${err}`);
                
                // 🔔 Discord: Error Counter kritisch (>= 3 Fehler)
                if (errorCounter >= 3 && DISCORD_NOTIFY.errorCritical) {
                    sendDiscordNotification(
                        `❌ **Error Counter: ${errorCounter}/${MAX_ERRORS_BEFORE_STOP}**\n⚠️ DP: ${id}`,
                        'error',
                        'errorCritical'
                    );
                }
                
                // Bei MAX_ERRORS_BEFORE_STOP: Script stoppen
                if (errorCounter >= MAX_ERRORS_BEFORE_STOP) {
                    logError(`KRITISCH: ${errorCounter} konsekutive Fehler - Script wird gestoppt!`);
                    // 🔔 Discord: Script gestoppt (max. Fehler erreicht)
                    if (DISCORD_NOTIFY.scriptStopped) {
                        sendDiscordNotification(
                            `🛑 **Script gestoppt!**\n❌ ${errorCounter} Fehler erreicht`,
                            'critical',
                            'scriptStopped'
                        );
                    }
                    setIfChanged(dpSteuerung.stop, true);
                    return; // Keine weiteren Retries
                }
                
                // schedule retries with exponential backoff (best-effort)
                setIfChanged._retry = setIfChanged._retry || {};
                const attempt = (setIfChanged._retry[id] || 0) + 1;
                setIfChanged._retry[id] = attempt;
                const backoff = Math.min(30000, 200 * Math.pow(2, attempt));
                logDebug(`Fehler beim setState ${id} (Versuch ${attempt}), retry in ${backoff}ms`);
                setTimeout(() => {
                    try {
                        const controlIds = [dp.setAcMode, dp.setInputLimit, dp.setOutputLimit, dp.setSmartMode];
                        const statusIds = [dp.minVol_Schwelle, dpAkkuLeer, dpAkkuVollTag, dpModusAktuell, dpWatchdogAlarm, dpPersist.lastLadeleistung, dpPersist.notladenAktiv];
                        const steuerungIds = Object.values(dpSteuerung);
                        const isControl = controlIds.includes(id);
                        const isStatus = statusIds.includes(id);
                        const isSteuerung = steuerungIds.includes(id);
                        const ack = isControl ? false : ((isStatus || isSteuerung) ? true : false);
                        setState(id, { val: value, ack: ack });
                        delete setIfChanged._retry[id];
                        logDebug(`Retry erfolgreich ${id}`);
                    } catch (e) { logDebug(`Retry fehlgeschlagen ${id}`); }
                }, backoff);
            }
        } else {
            logDebug(`⏱️ Schreib-gedrosselt für ${id}`);
        }
    }
}

/**
 * Konvertiert Zeit-String zu Minuten seit Mitternacht.
 * @param {string} str - Zeit im Format 'HH:MM' oder 'HH:MM:SS'
 * @param {number|null} fallbackMinutes - Rückgabewert bei Fehler
 * @returns {number|null} Minuten seit Mitternacht oder Fallback
 * @example toMinutes('08:30') → 510
 */
function toMinutes(str, fallbackMinutes = null) {
    // Robustes Parsing: erwartet 'HH:MM' oder 'HH:MM:SS' (Sekunden werden ignoriert)
    if (!str || typeof str !== 'string') {
        logDebug(`toMinutes: ungültiger Wert '${str}', fallback ${fallbackMinutes}`);
        return fallbackMinutes;
    }
    const m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) {
        logDebug(`toMinutes: Formatfehler '${str}' (erwartet HH:MM), fallback ${fallbackMinutes}`);
        return fallbackMinutes;
    }
    const hNum = Number(m[1]);
    const mNum = Number(m[2]);
    
    // Strikte Validierung: Stunden 0-23, Minuten 0-59
    if (Number.isNaN(hNum) || Number.isNaN(mNum)) {
        logDebug(`toMinutes: NaN-Werte in '${str}', fallback ${fallbackMinutes}`);
        return fallbackMinutes;
    }
    if (hNum < 0 || hNum > 23) {
        logDebug(`toMinutes: Stunden ${hNum} außerhalb 0-23 in '${str}', fallback ${fallbackMinutes}`);
        return fallbackMinutes;
    }
    if (mNum < 0 || mNum > 59) {
        logDebug(`toMinutes: Minuten ${mNum} außerhalb 0-59 in '${str}', fallback ${fallbackMinutes}`);
        return fallbackMinutes;
    }
    
    const result = hNum * 60 + mNum;
    
    // Plausibilitätsprüfung für Astro-Zeiten (nur Warnung, kein Block)
    // Sunrise sollte zwischen 4:00-10:00 (240-600), Sunset zwischen 16:00-22:00 (960-1320) sein
    if (result < 180 || result > 1380) {
        logDebug(`toMinutes: Unplausible Astro-Zeit '${str}' (${result} Min) - prüfe Quelle (OK in Polarregionen)`);
    }
    
    return result;
}

function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

/**
 * Findet nächst-kleinere Ladestufe für gegebenen Wert.
 * @param {number} value - Gewünschte Ladeleistung in Watt
 * @returns {number} Nächste erlaubte Stufe (100-900W, oder 0)
 * @example nearestStep(650) → 600
 */
function nearestStep(value) {
    // return the largest step <= value (or 0)
    return LADESTUFEN.reduce((acc, s) => (value >= s ? s : acc), 0);
}

/**
 * Prüft und aktualisiert Notlade-Status mit Hysterese und konfigurierbarer Schwelle.
 * @param {number} minVol - Aktuelle minimale Zellspannung
 * @returns {boolean} true wenn Notladen aktiv, false sonst
 */
function checkNotladen(minVol) {
    // Schwellwert aus DP lesen - je nach Wetter-Modus
    const schlecht = getState(dpSteuerung.schlechtWetter).val === true;
    const dpNotlade = schlecht ? dpSteuerung.minVolNotladeSchlecht : dpSteuerung.minVolNotlade;
    const defaultVal = schlecht ? 3.05 : DEFAULT_MINVOL_NOTLADE;
    const minRange = schlecht ? 2.95 : 2.90;
    const maxRange = schlecht ? 3.15 : 3.10;
    
    const minVolNotlade = validateConfig('MinVol_Notlade_Schwelle',
        safeNumber(getState(dpNotlade).val), minRange, maxRange, defaultVal);
    
    const minVolRecover = minVolNotlade + MINVOL_HYSTERESE; // +0.10V Hysterese
    
    // Notladen aktivieren wenn unter Schwelle
    if (minVol <= minVolNotlade) {
        notladenAktiv = true;
    }
    // Notladen deaktivieren wenn über Schwelle + Hysterese
    if (notladenAktiv && minVol >= minVolRecover) {
        notladenAktiv = false;
    }
    return notladenAktiv;
}

/**
 * Prüft und aktualisiert Akku-Leer-Status (Entladestopp) mit Hysterese.
 * @param {number} minVol - Aktuelle minimale Zellspannung
 * @param {number} minVol_S - Entladestopp-Schwelle
 * @returns {boolean} true wenn Akku leer (Entladen blockiert), false sonst
 */
function checkAkkuLeer(minVol, minVol_S) {
    // Aktivieren wenn unter Schwelle
    if (minVol <= minVol_S) {
        if (!akkuLeer) {
            logDebug(`Akku-Leer aktiviert: minVol=${minVol.toFixed(3)}V <= ${minVol_S.toFixed(3)}V`);
            // 🔔 Discord: Akku-Leer aktiviert (Entladestopp, einmalig)
            if (DISCORD_NOTIFY.akkuLeer) {
                sendDiscordNotification(
                    `🔋 **Akku-Leer aktiviert**\n⚠️ Entladestopp | MinVol: ${minVol.toFixed(3)}V`,
                    'warn',
                    'akkuLeer'
                );
            }
        }
        akkuLeer = true;
    }
    // Deaktivieren wenn über Schwelle + Hysterese
    if (akkuLeer && minVol >= minVol_S + MINVOL_HYSTERESE) {
        logDebug(`Akku-Leer deaktiviert: minVol=${minVol.toFixed(3)}V >= ${(minVol_S + MINVOL_HYSTERESE).toFixed(3)}V (Schwelle=${minVol_S.toFixed(3)}V + Hysterese=${MINVOL_HYSTERESE.toFixed(3)}V)`);
        akkuLeer = false;
    }
    return akkuLeer;
}

// ----------------------------------------------------------
// ✅ STATE-VARIABLEN (vor Initialisierung deklarieren!)
// ----------------------------------------------------------
// Globale Variablen für Sticky Charging und Hysterese-Flags:
let lastLadeleistung = 0;   // zuletzt gesetzte Ladeleistung (für Sticky Charging)
let notladenAktiv = false;   // Notlade-Flag (3.0V-3.3V Hysterese)
let akkuLeer = false;        // Entlade-Blockade-Flag (minVol_Schwelle ±0.1V Hysterese)
let akkuVollTag = false;     // SOC=100% Sticky-Flag (bleibt bis Sonnenuntergang)
let errorCounter = 0;        // Fehler-Zähler für Error Recovery
let lastErrorTime = 0;       // Zeitpunkt des letzten Fehlers
let lastAcMode = 1;          // Letzter bekannter acMode für sanfte Übergänge

// Watchdog State-Tracking
const watchdogState = {
    hausPower: { value: null, lastChange: Date.now() },
    minVol: { value: null, lastChange: Date.now() },
    astro: { sunriseNull: false, sunsetNull: false, firstNullSeen: null }
};

// ----------------------------------------------------------
// ✅ Initialisierung aus Device- und Persist-States
// ----------------------------------------------------------
// 1. lastLadeleistung aus aktuellem inputLimit initialisieren (Cold-Start-Schutz)
try {
    if (existsState(dp.inputLimit)) {
        const cur = Number(getState(dp.inputLimit).val);
        if (!Number.isNaN(cur)) lastLadeleistung = cur;
    }
} catch (e) {
    logDebug('Konnte initialen inputLimit-Wert nicht lesen');
}

// 2. Persistierte Werte aus 0_userdata lesen (überschreiben Defaults)
try {
    if (existsState(dpPersist.notladenAktiv)) {
        const v = getState(dpPersist.notladenAktiv).val;
        notladenAktiv = v === true || v === 'true' || v === 1;
    }
    if (existsState(dpPersist.lastLadeleistung)) {
        const v = Number(getState(dpPersist.lastLadeleistung).val);
        if (Number.isFinite(v)) lastLadeleistung = v;
    }
    if (existsState(dpPersist.errorCounter)) {
        const v = Number(getState(dpPersist.errorCounter).val);
        if (Number.isFinite(v)) errorCounter = v;
    }
    if (existsState(dpPersist.lastAcMode)) {
        const v = Number(getState(dpPersist.lastAcMode).val);
        if (Number.isFinite(v) && (v === 1 || v === 2)) lastAcMode = v;
    }
} catch (e) {
    logDebug('Konnte persistente States nicht lesen');
}

// 3. Status-Flags aus userdata lesen
try {
    if (existsState(dpAkkuLeer)) {
        const val = getState(dpAkkuLeer).val;
        akkuLeer = val === true || val === 'true' || val === 1;
        logDebug(`Init: akkuLeer=${akkuLeer} (aus DP)`);
    }
    if (existsState(dpAkkuVollTag)) {
        const val = getState(dpAkkuVollTag).val;
        akkuVollTag = val === true || val === 'true' || val === 1;
        logDebug(`Init: akkuVollTag=${akkuVollTag} (aus DP)`);
    }
} catch (e) {
    logDebug('Konnte Status-States nicht lesen');
}


// ----------------------------------------------------------
// ✅ MinVol dynamisch aus konfigurierten Packs berechnen
// ----------------------------------------------------------
/**
 * Liest minVol aus allen konfigurierten Packs (2-4+), berechnet das Minimum
 * und schreibt es nach dp.minVol. Warnung bei < 2 gültigen Packs.
 */
function recalcMinVol() {
    try {
        const minValues = [];
        let validPackCount = 0;
        
        // Dynamisch durch alle konfigurierten Packs iterieren
        Object.keys(packDPs).forEach((key, index) => {
            const packDP = packDPs[key];
            const packState = getState(packDP);
            
            if (packState !== null && packState.val !== null && packState.val !== undefined) {
                const val = Number(packState.val);
                // Sensor-Validierung: MinVol muss zwischen 2.5V und 4.0V liegen
                if (Number.isFinite(val) && val >= 2.5 && val <= 4.0) {
                    minValues.push(val);
                    validPackCount++;
                    logDebug(`Pack ${index + 1} (${BATTERY_PACKS[index]}): ${val.toFixed(3)}V`);
                } else if (Number.isFinite(val)) {
                    logWarn(`Pack ${index + 1} (${BATTERY_PACKS[index]}): Ungültige Spannung ${val.toFixed(3)}V (außerhalb 2.5-4.0V) - überspringe`);
                }
            } else {
                logDebug(`Pack ${index + 1} (${BATTERY_PACKS[index]}): Keine gültigen Daten`);
            }
        });
        
        // Warning wenn zu wenige Packs gefunden
        if (validPackCount < 2 && validPackCount > 0) {
            logWarn(`Nur ${validPackCount} Pack(s) mit gültigen Daten - empfohlen sind mindestens 2 für zuverlässige minVol-Überwachung`);
        }
        
        // Minimum berechnen
        let overallMin = minValues.length > 0 ? Math.min(...minValues) : Infinity;
        
        // Fallback falls alle Packs ungültig sind
        if (overallMin === Infinity || validPackCount === 0) {
            logWarn(`⚠️ Keine gültigen Pack-minVol Werte verfügbar (${BATTERY_PACKS.length} Packs konfiguriert, ${validPackCount} gültig) - nutze Fallback 3.5V`);
            overallMin = 3.5;
            // Alarm-DP setzen für Pack-Ausfall
            if (existsState(dpWatchdogAlarm)) {
                setState(dpWatchdogAlarm, '⚠️ Pack-Überwachung ausgefallen - Alle Packs offline!', true);
            }
        } else {
            logInfo(`MinVol berechnet aus ${validPackCount}/${BATTERY_PACKS.length} Packs: ${overallMin.toFixed(3)}V`);
            // Alarm zurücksetzen wenn mindestens 1 Pack gültig
            if (existsState(dpWatchdogAlarm)) {
                const currentAlarm = getState(dpWatchdogAlarm).val;
                if (currentAlarm && currentAlarm.includes('Pack-Überwachung')) {
                    setState(dpWatchdogAlarm, '', true);
                }
            }
        }

        // Schreibe das Ergebnis nach dp.minVol
        setState(dp.minVol, overallMin, true);
        
        logDebug(`MinVol berechnet: ${overallMin.toFixed(3)}V`);
        
        // ENTFERNT: Schlechtwetter-DP Logik (jetzt durch konfigurierbaren Entladestopp-DP ersetzt)
        // Die Schwelle wird jetzt über dpSteuerung.minVolEntladestopp gesteuert
    } catch (err) {
        logError(`recalcMinVol Fehler: ${err}`);
    }
}

// Trigger auf alle Pack-minVol DPs einrichten (dynamisch aus packDPs)
const packMinVolStates = Object.values(packDPs);

if (packMinVolStates.length === 0) {
    logError('⚠️ FEHLER: Keine Battery Packs in BATTERY_PACKS Array konfiguriert!');
    logError('Bitte mindestens 2 Pack-IDs in der USER CONFIG eintragen.');
} else if (packMinVolStates.length < 2) {
    logWarn(`Nur ${packMinVolStates.length} Pack konfiguriert - empfohlen sind mindestens 2 für Redundanz`);
} else {
    logInfo(`✅ ${packMinVolStates.length} Battery Packs konfiguriert und überwacht`);
}

packMinVolStates.forEach(function(stateID) {
    on({ id: stateID, change: "any" }, function (obj) {
        recalcMinVol();
    });
});

// ENTFERNT: Schlechtwetter-Trigger (ersetzt durch konfigurierbare Entladestopp-Schwelle)

// Initiale Berechnung (verzögert nach Script-Start)
setTimeout(() => recalcMinVol(), 2000);


// ----------------------------------------------------------
// ✅ Watchdog für eingefrorene Werte
// ----------------------------------------------------------
/**
 * Prüft kritische Datenpunkte auf eingefrorene Werte und schreibt Alarm.
 */
function checkWatchdog() {
    const now = Date.now();
    const alarms = [];

    try {
        // 1. hausPower-Check
        const hausPower = safeNumber(getState(dp.hausPower).val, null);
        if (hausPower !== null) {
            if (watchdogState.hausPower.value === hausPower) {
                const minutesUnchanged = (now - watchdogState.hausPower.lastChange) / 60000;
                if (minutesUnchanged > WATCHDOG_HAUSPOWER_MIN) {
                    alarms.push(`⚠️ hausPower unverändert seit ${Math.round(minutesUnchanged)}min (${hausPower}W)`);
                }
            } else {
                watchdogState.hausPower.value = hausPower;
                watchdogState.hausPower.lastChange = now;
            }
        }

        // 2. minVol-Check (nur bei aktiver Last - Laden oder Entladen)
        const minVol = safeNumber(getState(dp.minVol).val, null);
        const inputLimit = safeNumber(getState(dp.setInputLimit).val, 0);
        const outputLimit = safeNumber(getState(dp.setOutputLimit).val, 0);
        const isActive = (inputLimit > 0 || outputLimit > 0);  // Nur bei Aktivität prüfen
        
        if (minVol !== null && isActive) {
            if (watchdogState.minVol.value === minVol) {
                const minutesUnchanged = (now - watchdogState.minVol.lastChange) / 60000;
                if (minutesUnchanged > WATCHDOG_MINVOL_MIN) {
                    alarms.push(`⚠️ minVol unverändert seit ${Math.round(minutesUnchanged)}min (${minVol}V)`);
                }
            } else {
                watchdogState.minVol.value = minVol;
                watchdogState.minVol.lastChange = now;
            }
        } else if (minVol !== null && !isActive) {
            // Bei Standby: Timestamp aktualisieren damit nach Aktivität kein False-Alarm kommt
            watchdogState.minVol.value = minVol;
            watchdogState.minVol.lastChange = now;
        }

        // 3. Sunrise/Sunset-Check
        const sunrise = getState(dp.sunrise).val;
        const sunset = getState(dp.sunset).val;
        const astroNull = (!sunrise || !sunset);
        
        if (astroNull) {
            if (!watchdogState.astro.firstNullSeen) {
                watchdogState.astro.firstNullSeen = now;
            } else {
                const hoursNull = (now - watchdogState.astro.firstNullSeen) / 3600000;
                if (hoursNull > WATCHDOG_ASTRO_HOURS) {
                    alarms.push(`⚠️ Sunrise/Sunset = null seit ${Math.round(hoursNull)}h`);
                }
            }
        } else {
            watchdogState.astro.firstNullSeen = null;
        }

        // Alarm-Status aktualisieren
        if (alarms.length > 0) {
            const alarmMsg = alarms.join(' | ');
            setIfChanged(dpWatchdogAlarm, alarmMsg);
            logError(`WATCHDOG-ALARM: ${alarmMsg}`);
            // 🔔 Discord: Watchdog-Alarm (Sensor ausgefallen)
            if (DISCORD_NOTIFY.watchdogAlarm) {
                sendDiscordNotification(
                    `🚨 **Watchdog-Alarm**\n${alarms.join('\n')}`,
                    'error',
                    'watchdogAlarm'
                );
            }
        } else {
            // Alarm zurücksetzen falls vorher einer aktiv war
            const currentAlarm = getState(dpWatchdogAlarm).val;
            if (currentAlarm && currentAlarm !== '') {
                setIfChanged(dpWatchdogAlarm, '');
                logInfo('Watchdog: Alle Werte OK');
            }
        }
    } catch (err) {
        logDebug(`Watchdog-Fehler: ${err}`);
    }
}

// Watchdog starten: alle 10 Minuten
schedule(`0 */${WATCHDOG_INTERVAL_MIN} * * * *`, () => checkWatchdog());


// ----------------------------------------------------------
// ✅ Entscheidungslogik in testbarer Funktion
// ----------------------------------------------------------
/**
 * Zentrale Entscheidungslogik für Lade-/Entladevorgänge.
 * Pure function (außer globale State-Variablen für Sticky/Hysterese).
 * @param {Object} inputs - Eingabeparameter
 * @param {number} inputs.hausPower - Hausverbrauch in Watt (negativ = Einspeisung)
 * @param {number} inputs.soc - State of Charge in % (0-100)
 * @param {number} inputs.minVol - Aktuelle minimale Zellspannung in Volt
 * @param {number} inputs.minVol_S - Schwellwert für Entladestopp in Volt
 * @param {boolean} inputs.smartMode - SmartMode-Status des Devices
 * @param {number} inputs.sunrise - Sonnenaufgang in Minuten seit Mitternacht (validiert)
 * @param {number} inputs.sunset - Sonnenuntergang in Minuten seit Mitternacht (validiert)
 * @param {number} inputs.now - Aktuelle Zeit in Minuten seit Mitternacht
 * @param {string} inputs.modus - Betriebsmodus (Sonnenzeit, Manuell-Laden)
 * @param {number} inputs.netzbezugZielLaden - Ziel-Netzbezug in Watt (für Laden)
 * @param {number} inputs.maxLadeleistung - Maximale Ladeleistung
 * @param {number} inputs.entladeleistungTag - Entladeleistung tagsüber
 * @param {number} inputs.entladeleistungNacht - Entladeleistung nachts
 * @param {number} inputs.sunriseOffsetMin - Sunrise-Offset in Minuten
 * @param {number} inputs.sunsetOffsetMin - Sunset-Offset in Minuten
 * @param {boolean} inputs.stickyChargingAktiv - Sticky Charging Feature aktiv
 * @param {boolean} inputs.tagEntladenBei100Aktiv - Tag-Entladen bei 100% aktiv
 * @returns {Object} Actions-Objekt mit setXXX, dpXXX und debug[]
 */
function evaluateStep(inputs) {
    // inputs erweitert um Steuerungsparameter
    const actions = {
        setAcMode: undefined,
        setInputLimit: undefined,
        setOutputLimit: undefined,
        setSmartMode: undefined,
        dpAkkuLeer: undefined,
        dpAkkuVollTag: undefined,
        dpModus: undefined,
        debug: []
    };

    const hausPower = inputs.hausPower;
    const soc = inputs.soc;
    const minVol = inputs.minVol;
    const minVol_S = inputs.minVol_S;
    const smartMode = inputs.smartMode;
    const sunrise = inputs.sunrise;
    const sunset = inputs.sunset;
    const now = inputs.now;
    
    // Steuerungsparameter
    const modus = inputs.modus || 'Sonnenzeit';
    const NETZBEZUG_ZIEL_LADEN = inputs.netzbezugZielLaden !== undefined ? inputs.netzbezugZielLaden : DEFAULT_NETZBEZUG_ZIEL_LADEN;
    const MAX_LADELEISTUNG = inputs.maxLadeleistung || DEFAULT_MAX_LADELEISTUNG;
    const ENTLADELEISTUNG_TAG = inputs.entladeleistungTag || DEFAULT_ENTLADELEISTUNG_TAG;
    const ENTLADELEISTUNG_NACHT = inputs.entladeleistungNacht || DEFAULT_ENTLADELEISTUNG_NACHT;
    const SUNRISE_OFFSET_MIN = inputs.sunriseOffsetMin !== undefined ? inputs.sunriseOffsetMin : DEFAULT_SUNRISE_OFFSET_MIN;
    const SUNSET_OFFSET_MIN = inputs.sunsetOffsetMin !== undefined ? inputs.sunsetOffsetMin : DEFAULT_SUNSET_OFFSET_MIN;
    const stickyChargingAktiv = inputs.stickyChargingAktiv !== undefined ? inputs.stickyChargingAktiv : true;
    const tagEntladenBei100Aktiv = inputs.tagEntladenBei100Aktiv !== undefined ? inputs.tagEntladenBei100Aktiv : true;

    // Sunrise/Sunset mit Offsets (bereits validiert und als Minuten übergeben)
    const sunriseMin = sunrise + SUNRISE_OFFSET_MIN;
    const sunsetMin = sunset + SUNSET_OFFSET_MIN;

    // SmartMode
    if (smartMode !== true) {
        actions.setSmartMode = true;
        actions.debug.push('SmartMode aktiviert');
    }

    // akkuVollTag-Reset bei Sonnenuntergang (MODUSNUNABHÄNGIG, vor allen Modi-Checks!)
    if (now > sunsetMin && akkuVollTag) {
        logDebug('akkuVollTag zurückgesetzt (Sonnenuntergang)');
        akkuVollTag = false;
        // Wird am Ende als dpAkkuVollTag gesetzt (jeder Modus propagiert)
    }

    // MODUS-ABHÄNGIGE LOGIK
    // Manuell-Laden Modus: Laden mit max. Leistung bis 100% SOC
    if (modus === 'Manuell-Laden') {
        // Notladen hat auch hier Vorrang (Sicherheit geht vor)
        if (checkNotladen(minVol)) {
            lastLadeleistung = NOTLADE_INPUT;
            actions.setAcMode = NOTLADE_ACMODE;
            actions.setInputLimit = NOTLADE_INPUT;
            actions.setOutputLimit = NOTLADE_OUTPUT;
            actions.dpModus = 'Manuell: Notladen';
            actions.debug.push('Manuell-Laden: Notladen hat Vorrang');
            actions.dpAkkuLeer = akkuLeer;
            actions.dpAkkuVollTag = akkuVollTag;
            return actions;
        }
        
        // Entladestopp-Schutz
        checkAkkuLeer(minVol, minVol_S);
        
        // Laden bis SOC = 100%
        if (soc < 100) {
            lastLadeleistung = MAX_LADELEISTUNG;
            actions.setAcMode = 1;
            actions.setInputLimit = MAX_LADELEISTUNG;
            actions.setOutputLimit = 0;
            actions.dpModus = `Manuell: ${MAX_LADELEISTUNG}W`;
            actions.debug.push(`Manuell-Laden: Lade mit ${MAX_LADELEISTUNG}W, SOC ${soc}%`);
        } else {
            // SOC = 100%: Standby + akkuVollTag setzen (am Tag)
            if (now >= sunriseMin && now <= sunsetMin) {
                akkuVollTag = true;
            }
            lastLadeleistung = 0;
            actions.setAcMode = 1;
            actions.setInputLimit = 0;
            actions.setOutputLimit = 0;
            actions.dpModus = 'Manuell: Voll (100%)';
            actions.debug.push('Manuell-Laden: SOC 100% erreicht, Standby');
        }
        actions.dpAkkuLeer = akkuLeer;
        actions.dpAkkuVollTag = akkuVollTag;  // Propagieren
        return actions;
    }

    // SONNENZEIT-MODUS (Standard) - ab hier alle folgenden Blöcke
    // BLOCK A - NOTLADEN
    if (checkNotladen(minVol)) {
        lastLadeleistung = NOTLADE_INPUT;
        actions.setAcMode = NOTLADE_ACMODE;
        actions.setInputLimit = NOTLADE_INPUT;
        actions.setOutputLimit = NOTLADE_OUTPUT;
        actions.dpModus = 'Notladen';
        actions.debug.push('Notladen aktiv');
        // 🔔 Discord: Notladen aktiviert (kritische Spannung)
        if (DISCORD_NOTIFY.notladen) {
            sendDiscordNotification(
                `⚠️ **Notladen aktiv**\n🔋 MinVol: ${minVol.toFixed(3)}V | SOC: ${soc}%`,
                'warn',
                'notladen'
            );
        }
        // propagate dp states
        actions.dpAkkuLeer = akkuLeer;
        actions.dpAkkuVollTag = akkuVollTag;
        return actions;
    }

    // BLOCK B - ENTLADESTOPP (checkAkkuLeer() nutzt globales akkuLeer)
    checkAkkuLeer(minVol, minVol_S);
    
    // Akku-Leer-Schutz: NUR Entladen blockieren, Laden ist erlaubt!
    if (akkuLeer) {
        logDebug(`Akku-Leer-Status aktiv: minVol=${minVol.toFixed(3)}V, Schwelle=${minVol_S.toFixed(3)}V, Erholung=${(minVol_S + MINVOL_HYSTERESE).toFixed(3)}V`);
        
        // Nacht: Kein Entladen möglich → Standby
        if (now < sunriseMin || now > sunsetMin) {
            lastLadeleistung = 0;
            actions.setAcMode = 1;
            actions.setInputLimit = 0;
            actions.setOutputLimit = 0;
            actions.dpModus = 'Akku-Leer (Nacht)';
            actions.debug.push('Akku leer – Nacht: Entladen blockiert, Standby');
            actions.dpAkkuLeer = true;
            return actions;
        }
        // Tag: Entladen blockiert, aber Laden ist erlaubt → weiter zu BLOCK D (normale Lade-Logik)
        logDebug('Akku leer – Tag: Entladen blockiert, aber Laden erlaubt (weiter zu Lade-Logik)');
    }

    // BLOCK C - TAG-ENTLADEN Sticky bei SOC 100 (Feature-Toggle)
    if (tagEntladenBei100Aktiv && now >= sunriseMin && now <= sunsetMin) {
        if (soc >= 100) {
            akkuVollTag = true;
            actions.dpAkkuVollTag = true;
        }
        // WICHTIG: Nur entladen wenn Akku NICHT leer ist!
        if (akkuVollTag && !akkuLeer) {
            lastLadeleistung = 0;
            actions.setAcMode = 2;
            actions.setInputLimit = 0;
            actions.setOutputLimit = ENTLADELEISTUNG_TAG;
            actions.dpModus = 'Tag-Entladen (SOC 100%)';
            actions.debug.push('AkkuVoll_Tag aktiv – Tag-Entladen');
            return actions;
        }
        // Falls akkuVollTag=true ABER akkuLeer=true: weiter zu Lade-Logik
        if (akkuVollTag && akkuLeer) {
            logDebug('AkkuVoll_Tag gesetzt, aber Akku leer → Laden statt Entladen');
        }
    }

    // BLOCK D - TAG dynamisches Laden (Sonnenzeit-Modus)
    if (now >= sunriseMin && now <= sunsetMin) {
        const netzbezug = hausPower;
        const ueberschuss = NETZBEZUG_ZIEL_LADEN - hausPower;

        let ladeWunsch = nearestStep(ueberschuss);
        if (ladeWunsch < 0) ladeWunsch = 0;
        if (ladeWunsch > MAX_LADELEISTUNG) ladeWunsch = MAX_LADELEISTUNG;

        // Sticky Charging (optional)
        if (stickyChargingAktiv) {
            if (ladeWunsch > lastLadeleistung) lastLadeleistung = ladeWunsch;

            if (ladeWunsch < lastLadeleistung) {
                if (netzbezug > NETZBEZUG_ZIEL_LADEN) {
                    const differenz = netzbezug - NETZBEZUG_ZIEL_LADEN;
                    let neueLeistung = lastLadeleistung - differenz;
                    neueLeistung = nearestStep(neueLeistung);
                    if (neueLeistung < 0) neueLeistung = 0;
                    lastLadeleistung = neueLeistung;
                    ladeWunsch = neueLeistung;
                } else {
                    ladeWunsch = lastLadeleistung;
                }
            } else {
                lastLadeleistung = ladeWunsch;
            }
        } else {
            // Ohne Sticky: Direkt auf Zielwert regeln
            lastLadeleistung = ladeWunsch;
        }

        actions.setAcMode = 1;
        actions.setInputLimit = ladeWunsch;
        actions.setOutputLimit = 0;
        actions.dpModus = akkuLeer ? 'Sonnenzeit: Laden (Akku-Leer)' : 'Sonnenzeit: Laden';
        actions.debug.push(`Sonnenzeit-Modus: lade ${ladeWunsch}W${akkuLeer ? ' (Akku-Leer, PV-Überschuss)' : ''}`);
        return actions;
    }

    // BLOCK E/F - NACHT Entladen
    // Entladestopp-Schutz: Bei akkuLeer kein Entladen!
    if (akkuLeer) {
        lastLadeleistung = 0;
        actions.setAcMode = 1;
        actions.setInputLimit = 0;
        actions.setOutputLimit = 0;
        actions.dpModus = 'Nacht: Akku-Leer';
        actions.debug.push('Nacht: Entladen blockiert (Akku leer)');
        actions.dpAkkuLeer = true;
        actions.dpAkkuVollTag = akkuVollTag;
        return actions;
    }
    
    lastLadeleistung = 0;
    actions.setAcMode = 2;
    actions.setInputLimit = 0;
    actions.setOutputLimit = ENTLADELEISTUNG_NACHT;
    actions.dpModus = 'Nacht-Entladen';
    actions.debug.push('Nachtmodus: Entladen');
    actions.dpAkkuLeer = false;  // Propagieren
    actions.dpAkkuVollTag = akkuVollTag;  // Propagieren

    return actions;
}




// ----------------------------------------------------------
// ✅ HAUPTLOGIK (läuft jede Minute, Sekunde 0)
// ----------------------------------------------------------

// Discord Startup-Test beim Script-Start
sendDiscordStartupTest();

schedule('0 * * * * *', async () => {
    try {
        // Error Counter Auto-Reset nach ERROR_RESET_AFTER_MS ohne Fehler
        const nowMs = Date.now();
        if (errorCounter > 0 && lastErrorTime > 0 && nowMs - lastErrorTime > ERROR_RESET_AFTER_MS) {
            logInfo(`Error Counter von ${errorCounter} zurückgesetzt (${Math.round((nowMs - lastErrorTime)/60000)}min fehlerfrei)`);
            errorCounter = 0;
            persistState(dpPersist.errorCounter, 0);
        }
        
        // Stop-Check: Script pausieren
        const scriptStop = getState(dpSteuerung.stop).val;
        if (scriptStop === true) {
            setIfChanged(dpModusAktuell, 'GESTOPPT');
            logDebug('Script gestoppt durch Stop-Flag');
            return;
        }

        // Device-Werte lesen + Sensor-Validierung
        const hausPower = validateConfig('Haus_Leistung (Sensor)',
            safeNumber(getState(dp.hausPower).val), -10000, 10000, 0);
        const soc = validateConfig('SOC (Sensor)',
            safeNumber(getState(dp.soc).val), 0, 100, 50);
        const minVol = validateConfig('MinVol (Sensor)',
            safeNumber(getState(dp.minVol).val), 2.5, 4.0, 3.5);
        const smartMode = getState(dp.smartMode).val;
        
        // Zeit-Sensoren mit Fallback (06:00 / 18:00 bei Ausfall)
        const sunriseStr = getState(dp.sunrise).val;
        const sunsetStr = getState(dp.sunset).val;
        const sunrise = toMinutes(sunriseStr, 360);  // Fallback 06:00 (360min)
        const sunset = toMinutes(sunsetStr, 1080);   // Fallback 18:00 (1080min)
        
        // Warning wenn Astro-Werte fehlen
        if (sunriseStr === null || sunriseStr === undefined || sunrise === 360) {
            if (!watchdogState.astro.sunriseNull) {
                logWarn('⚠️ Sunrise-Wert nicht verfügbar - nutze Fallback 06:00 (prüfe Astro-Adapter)');
                watchdogState.astro.sunriseNull = true;
            }
        } else {
            watchdogState.astro.sunriseNull = false;
        }
        if (sunsetStr === null || sunsetStr === undefined || sunset === 1080) {
            if (!watchdogState.astro.sunsetNull) {
                logWarn('⚠️ Sunset-Wert nicht verfügbar - nutze Fallback 18:00 (prüfe Astro-Adapter)');
                watchdogState.astro.sunsetNull = true;
            }
        } else {
            watchdogState.astro.sunsetNull = false;
        }
        
        const now = nowMinutes();

        // Steuerungsparameter lesen und validieren
        const modus = validateModus(getState(dpSteuerung.modus).val);
        const netzbezugZielLaden = validateConfig('Netzbezug_Ziel_Laden', 
            safeNumber(getState(dpSteuerung.netzbezugZielLaden).val), 0, 5000, DEFAULT_NETZBEZUG_ZIEL_LADEN);
        const maxLadeleistung = validateConfig('Max_Ladeleistung', 
            safeNumber(getState(dpSteuerung.maxLadeleistung).val), 0, 1200, DEFAULT_MAX_LADELEISTUNG);
        const entladeleistungTag = validateConfig('Entladeleistung_Tag', 
            safeNumber(getState(dpSteuerung.entladeleistungTag).val), 0, 1200, DEFAULT_ENTLADELEISTUNG_TAG);
        const entladeleistungNacht = validateConfig('Entladeleistung_Nacht', 
            safeNumber(getState(dpSteuerung.entladeleistungNacht).val), 0, 1200, DEFAULT_ENTLADELEISTUNG_NACHT);
        const sunriseOffsetMin = validateConfig('Sunrise_Offset', 
            safeNumber(getState(dpSteuerung.sunriseOffset).val), -120, 120, DEFAULT_SUNRISE_OFFSET_MIN);
        const sunsetOffsetMin = validateConfig('Sunset_Offset', 
            safeNumber(getState(dpSteuerung.sunsetOffset).val), -120, 120, DEFAULT_SUNSET_OFFSET_MIN);
        const stickyChargingAktiv = getState(dpSteuerung.stickyChargingAktiv).val !== false;
        const tagEntladenBei100Aktiv = getState(dpSteuerung.tagEntladenBei100Aktiv).val !== false;
        
        // Schutz-Schwellwerte aus Steuerungs-DPs lesen - je nach Wetter-Modus
        const schlecht = getState(dpSteuerung.schlechtWetter).val === true;
        const dpEntladestopp = schlecht ? dpSteuerung.minVolEntladestoppSchlecht : dpSteuerung.minVolEntladestopp;
        const defaultValEntlade = schlecht ? 3.20 : DEFAULT_MINVOL_ENTLADESTOPP;
        const minRangeEntlade = schlecht ? 3.10 : 3.00;
        const maxRangeEntlade = schlecht ? 3.40 : 3.30;
        
        const minVol_S = validateConfig('MinVol_Entladestopp_Schwelle',
            safeNumber(getState(dpEntladestopp).val), minRangeEntlade, maxRangeEntlade, defaultValEntlade);

        // Status-DP "minVol_Schwelle" automatisch aktualisieren (Anzeige in UI)
        setIfChanged(dp.minVol_Schwelle, minVol_S);

        // Debug-Log: Aktuelle Schwellwerte und Flags vor Auswertung
        logDebug(`Vor evaluateStep: minVol=${minVol.toFixed(3)}V, Schwelle=${minVol_S.toFixed(3)}V, Erholung=${(minVol_S + MINVOL_HYSTERESE).toFixed(3)}V, akkuLeer=${akkuLeer}`);

        const result = evaluateStep({
            hausPower,
            soc,
            minVol,
            minVol_S,
            smartMode,
            sunrise,
            sunset,
            now,
            modus,
            netzbezugZielLaden,
            maxLadeleistung,
            entladeleistungTag,
            entladeleistungNacht,
            sunriseOffsetMin,
            sunsetOffsetMin,
            stickyChargingAktiv,
            tagEntladenBei100Aktiv
        });

        // apply actions
        if (result.setSmartMode !== undefined) setIfChanged(dp.setSmartMode, result.setSmartMode);
        if (result.dpAkkuLeer !== undefined) {
            setIfChanged(dpAkkuLeer, result.dpAkkuLeer);
            akkuLeer = result.dpAkkuLeer; // Globales Flag synchron halten
        }
        if (result.dpAkkuVollTag !== undefined) {
            setIfChanged(dpAkkuVollTag, result.dpAkkuVollTag);
            akkuVollTag = result.dpAkkuVollTag; // Globales Flag synchron halten
        }
        if (result.dpModus !== undefined) setIfChanged(dpModusAktuell, result.dpModus);
        
        // Sanfte Modus-Übergänge: Prüfe ob acMode-Wechsel ansteht
        if (result.setAcMode !== undefined && result.setAcMode !== lastAcMode) {
            // acMode soll geändert werden
            const acEingangAktuell = safeNumber(getState(dp.acEingangAktuell).val, 0);
            const entladeleistungAktuell = safeNumber(getState(dp.entladeleistungAktuell).val, 0);
            
            let leistungIstNull = false;
            
            // Von Laden (1) zu Entladen (2): AC-Eingang muss 0 sein (PV spielt keine Rolle)
            if (lastAcMode === 1 && result.setAcMode === 2) {
                leistungIstNull = acEingangAktuell <= 5; // 5W Toleranz
            }
            // Von Entladen (2) zu Laden (1): Entladeleistung muss 0 sein
            else if (lastAcMode === 2 && result.setAcMode === 1) {
                leistungIstNull = entladeleistungAktuell <= 5; // 5W Toleranz
            }
            // Anderer Wechsel (z.B. von 0) oder unbekannt: Direkt erlauben
            else {
                leistungIstNull = true;
            }
            
            if (leistungIstNull) {
                // Leistung ist 0 → acMode-Wechsel durchführen
                setIfChanged(dp.setAcMode, result.setAcMode);
                lastAcMode = result.setAcMode;
                persistState(dpPersist.lastAcMode, lastAcMode);
                setIfChanged(dpModusWechselAktiv, false);
                logInfo(`acMode-Wechsel durchgeführt: ${lastAcMode} → ${result.setAcMode}`);
            } else {
                // Leistung noch nicht 0 → erst auf 0 runterregeln
                setIfChanged(dpModusWechselAktiv, true);
                if (lastAcMode === 1) {
                    // Aktuell Laden → inputLimit auf 0 setzen
                    setIfChanged(dp.setInputLimit, 0);
                    logInfo(`acMode-Wechsel vorbereiten: AC-Eingang runterfahren (${acEingangAktuell}W → 0W)`);
                } else if (lastAcMode === 2) {
                    // Aktuell Entladen → outputLimit auf 0 setzen
                    setIfChanged(dp.setOutputLimit, 0);
                    logInfo(`acMode-Wechsel vorbereiten: Entladeleistung runterfahren (${entladeleistungAktuell}W → 0W)`);
                }
                // acMode NICHT ändern - warten bis nächster Durchlauf
                logDebug('Warte auf Leistung=0 bevor acMode gewechselt wird');
            }
        } else if (result.setAcMode !== undefined) {
            // Kein Wechsel, nur Aktualisierung (z.B. gleichbleibend)
            setIfChanged(dp.setAcMode, result.setAcMode);
            lastAcMode = result.setAcMode;
            persistState(dpPersist.lastAcMode, lastAcMode);
            setIfChanged(dpModusWechselAktiv, false);
        }
        
        // Input/Output Limits setzen (wenn kein Wechsel aktiv)
        const modusWechselAktiv = getState(dpModusWechselAktiv).val === true;
        if (!modusWechselAktiv) {
            if (result.setInputLimit !== undefined) setIfChanged(dp.setInputLimit, result.setInputLimit);
            if (result.setOutputLimit !== undefined) setIfChanged(dp.setOutputLimit, result.setOutputLimit);
        }
        // Wenn Wechsel aktiv: Limits wurden bereits oben auf 0 gesetzt

        result.debug.forEach(d => logDebug(d));
        // persist globals if changed
        try {
            persistState(dpPersist.notladenAktiv, !!notladenAktiv);
            persistState(dpPersist.lastLadeleistung, Number(lastLadeleistung));
            persistState(dpPersist.errorCounter, Number(errorCounter));
            persistState(dpPersist.lastAcMode, Number(lastAcMode));
        } catch (e) { logWarn('Fehler beim Persistieren: ' + e); }
    } catch (err) {
        logError(`Fehler in Hauptlogik: ${err}`);
    }
});
