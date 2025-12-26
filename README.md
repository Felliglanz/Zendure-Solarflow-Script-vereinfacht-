# Zendure Solarflow Steuerung für ioBroker

**Version 2.0 STABLE** – Intelligente Lade- und Entladesteuerung für Zendure Solarflow Systeme mit 2 Betriebsmodi, dynamischer Pack-Überwachung, gehärteten Sicherheitsfunktionen und Discord-Push-Benachrichtigungen.

## 🌟 Features

- **2 Betriebsmodi** – Sonnenzeit (Auto) + Manuell-Laden
- **Gehärtete Sicherheit** 🆕 – Notladen funktioniert IMMER (auch bei Script-Stop)
- **Safe-Stop-Mechanismus** 🆕 – Bei Fehler: Device automatisch auf Standby (0W)
- **Sicherer MinVol-Fallback** 🆕 – Bei Sensor-Ausfall: 2.0V statt 3.5V (erzwingt Notladen)
- **Dynamische Pack-Erkennung** – Automatische Anpassung an 2-4+ Akkupacks
- **Wetter-adaptive Schwellwerte** – Normal/Schlechtwetter für optimalen Zellschutz
- **Sticky Charging** – Verhindert Regelflackern durch intelligente Laderegelung
- **Discord-Benachrichtigungen** – Push-Nachrichten für kritische Events mit Spam-Schutz
- **Multi-Level Logging** – ERROR/WARN/INFO/DEBUG für bessere Fehlersuche
- **Error Recovery** – Automatischer Safe-Stop nach 5 Fehlern
- **Notfall-Bypass** 🆕 – Notladen hat absolute Priorität (ignoriert Stop-Flag bei Gefahr)

## 📋 Voraussetzungen

- ioBroker Installation
- [Zendure Solarflow Adapter](https://github.com/nograx/ioBroker.zendure-solarflow)
- Stromzähler (Sonoff POWR3, Shelly 3EM, o.ä.) für Hausverbrauchsmessung
- JavaScript Adapter in ioBroker
- Astro Adapter (optional, für Sonnenzeit-Modus)

## 🚀 Installation

### 1. **Script-Code anpassen**
   Öffne das Script und passe die USER KONFIGURATION (Zeile 73-109) an:

   ```javascript
   // 1️⃣ ZENDURE DEVICES
   const HUB_DEVICE_ID = 'xxxxxxxx';     // Deine HUB Device-ID
   const ACE_DEVICE_ID = 'xxxxxxxx';     // Deine ACE Device-ID

   // 2️⃣ BATTERY PACKS (2-4+ möglich)
   const BATTERY_PACKS = [
       'xxxxxxxxxxxxxxx',  // Pack 1
       'xxxxxxxxxxxxxxx',  // Pack 2
       'xxxxxxxxxxxxxxx',  // Pack 3 (optional)
       'xxxxxxxxxxxxxxx'   // Pack 4 (optional)
   ];

   // 3️⃣ STROMZÄHLER
   const POWER_METER_DP = 'sonoff.0.Lesekopf.MT691_Power_curr';

   // 4️⃣ DISCORD (optional)
   const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/yourWebHook';
   const DISCORD_NOTIFICATIONS_ENABLED = true;  // true = aktiv
   ```

#### 🔍 **So findest du deine IDs:**

**Zendure Device IDs:**
1. ioBroker → Objekte → `zendure-solarflow.0`
2. Expandiere die Ordner-Struktur:
   ```
   zendure-solarflow.0/
   ├── 73bkTV/          → HUB Product ID (immer gleich)
   │   └── DEINE_ID/    → Deine HUB Device ID ✅ KOPIEREN
   └── 8bM93H/          → ACE Product ID (immer gleich)
       └── DEINE_ID/    → Deine ACE Device ID ✅ KOPIEREN
   ```

**Battery Pack IDs:**
1. Navigiere zu: `zendure-solarflow.0.73bkTV.{DEINE_HUB_ID}.packData`
2. Dort siehst du deine Packs – kopiere die IDs in das BATTERY_PACKS Array

**Power Meter Datenpunkt:**
- Voller Pfad zu deinem Stromzähler-DP
- Muss **positiv = Bezug**, **negativ = Einspeisung** liefern

### 2. **Script in ioBroker importieren**
   - Script in ioBroker JavaScript Adapter kopieren
   - Script aktivieren → **Datenpunkte werden automatisch angelegt**

### 3. **Datenpunkte prüfen**
   Nach dem ersten Start werden automatisch angelegt:
   ```
   0_userdata.0.Zendure/
   ├── Status/       → Script-Ausgaben (Modus, Akku-Status, Alarm)
   ├── Steuerung/    → Benutzer-Konfiguration (Modus, Schwellwerte, etc.)
   ├── Persist/      → Interne Variablen (Last-States, Error-Counter)
   └── Werte/        → Berechnete Werte (minVol, minVol_Schwelle)
   ```

## 🎯 Betriebsmodi

### 1. **Sonnenzeit** (Auto)
Der intelligente Allrounder für täglichen Betrieb.

- **Tag**: Laden bei PV-Überschuss mit Netzbezugsgrenze
- **Nacht**: Entladen mit konfigurierbarer Leistung
- **SOC 100%**: Automatisches Tag-Entladen aktiviert
- **Sticky Charging**: Ladeleistung steigt schnell, fällt verzögert
- **Notladen-Priorität**: Greift automatisch bei niedrigem minVol
- **Akku-Leer-Schutz**: Stoppt Entladen bei Unterschreitung der Schwellwerte

### 2. **Manuell-Laden**
Aktives AC-Laden direkt aus dem Netz.

- Lädt aktiv aus dem Stromnetz (unabhängig von PV)
- Max. Ladeleistung 900W bis 100% SOC
- Dann automatisch Standby
- **Notladen-Priorität**: Greift weiterhin bei kritischem minVol
- Ideal für: Schnellladen bei Bedarf, Akkutest, vor erwartetem Stromausfall

## ⚙️ Konfiguration

Alle Einstellungen erfolgen über Datenpunkte in `0_userdata.0.Zendure.Steuerung/`:

| Datenpunkt | Beschreibung | Standard |
|------------|--------------|----------|
| `Modus` | Betriebsmodus (Dropdown) | Sonnenzeit |
| `Netzbezug_Ziel_Laden` | Max. Netzbezug beim Laden | 100W |
| `Max_Ladeleistung` | Maximale Ladeleistung | 900W |
| `Entladeleistung_Tag` | Entladeleistung Tag | 1000W |
| `Entladeleistung_Nacht` | Entladeleistung Nacht | 1000W |
| `Sunrise_Offset_Min` | Sonnenaufgang +/- Minuten | 0 |
| `Sunset_Offset_Min` | Sonnenuntergang +/- Minuten | 0 |
| `Sticky_Charging_Aktiv` | Sticky-Charging ein/aus | true |
| `Tag_Entladen_Bei_100_Aktiv` | Tag-Entladen bei 100% SOC | true |

### 📱 Discord-Benachrichtigungen

**Push-Nachrichten für kritische Events direkt in deinen Discord-Kanal!**

#### Setup:
1. **Discord Webhook erstellen:**
   - Discord Server → Servereinstellungen → Integrationen → Webhooks
   - Neuer Webhook → Kanal auswählen → URL kopieren

2. **Im Script eintragen:**
   - Zeile 108: Webhook-URL eintragen
   - Zeile 109: `DISCORD_NOTIFICATIONS_ENABLED = true`

3. **Benachrichtigungen aktivieren/deaktivieren (Zeile 112-118):**
   ```javascript
   const DISCORD_NOTIFY = {
       notladen: true,           // ⚠️ Notladen aktiviert (kritische Spannung)
       akkuLeer: true,           // 🔋 Akku-Leer-Schutz (Entladestopp)
       watchdogAlarm: true,      // 🚨 Sensor-Ausfall erkannt
       errorCritical: true,      // ❌ 5 Fehler erreicht
       scriptStopped: true       // 🛑 Script gestoppt
   };
   ```

#### Features:
- **Spam-Schutz:** 15 Minuten Cooldown zwischen gleichen Meldungen
- **Startup-Test:** Beim Script-Start werden alle 5 Benachrichtigungstypen als Test gesendet
- **Kurz & prägnant:** Emojis + wichtigste Infos (MinVol, SOC)
- **Farb-codiert:** Gelb (Warnung), Rot (Fehler), Dunkelrot (Kritisch)
- **Konfigurierbar:** Jeder Event-Typ einzeln ein-/ausschaltbar

#### Beispiel-Nachrichten:
```
🔋 Akku-Leer aktiviert
⚠️ Entladestopp | MinVol: 3.087V

⚠️ Notladen aktiv
🔋 MinVol: 2.998V | SOC: 8%

🚨 Watchdog Alarm!
⚠️ Keine gültigen Sensordaten seit 5 Minuten
```

### 🌦️ Wetter-adaptive Schwellwerte

| Datenpunkt | Beschreibung | Standard |
|------------|--------------|----------|
| `Schlecht_Wetter` | Boolean-Schalter für Wetteranpassung | false |
| `MinVol_Notlade_Schwelle` | Notlade-Schwelle (Normal) | 3.00V |
| `MinVol_Notlade_Schwelle_Schlecht` | Notlade-Schwelle (Schlechtwetter) | 3.05V |
| `MinVol_Entladestopp_Schwelle` | Entladestopp-Schwelle (Normal) | 3.10V |
| `MinVol_Entladestopp_Schwelle_Schlecht` | Entladestopp-Schwelle (Schlechtwetter) | 3.20V |

**Automatisierung mit externem Script:**
```javascript
// Home Assistant / ioBroker Forecast-Script
if (temperature < 10 || rainProbability > 60) {
    setState('0_userdata.0.Zendure.Steuerung.Schlecht_Wetter', true);
    // → Script nutzt automatisch höhere Schwellwerte
} else {
    setState('0_userdata.0.Zendure.Steuerung.Schlecht_Wetter', false);
}
```



## 🛡️ Sicherheitsfunktionen

### Notladen (Höchste Priorität)
- Greift bei `minVol <= minVolNotlade` in **allen Modi**
  - Normal: 3.00V (konfigurierbar 2.90-3.10V)
  - Schlechtwetter: 3.05V (konfigurierbar 2.95-3.15V)
- Lädt mit 900W bis `minVol >= Schwelle + 0.10V` (Hysterese)
- Schützt vor Tiefentladung bei allen Temperaturen

### Entladestopp (Zellschutz)
- Blockiert Entladung bei `minVol <= minVolEntladestopp`
  - Normal: 3.10V (konfigurierbar 3.00-3.30V)
  - Schlechtwetter: 3.20V (konfigurierbar 3.10-3.40V)
- Hysterese: +0.10V zum Wiederfreigeben
- Dynamisch umschaltbar per `Schlecht_Wetter` DP

### Dynamische Pack-Überwachung
- Erkennt automatisch 1-4+ Akkupacks
- Berechnet minVol aus allen konfigurierten Packs
- Warning bei < 2 Packs erkannt
- Alarm-DP bei 0 Packs (System-Ausfall)
- Fallback auf 3.5V bei fehlenden Werten

### Hysterese-Schutz
Verhindert Flattern an Grenzwerten:
- Notladen: +0.10V Hysterese (gilt für Normal + Schlechtwetter)
- Entladestopp: +0.10V Hysterese (gilt für Normal + Schlechtwetter)

### Error Recovery & Watchdog
- **Error Counter**: Zählt fehlerhafte setState-Versuche
- **Auto-Stop**: Nach 5 Fehlern Script-Stop + Alarm + Discord-Benachrichtigung
- **Auto-Reset**: Nach 5 Min fehlerfreiem Betrieb
- **Intelligenter Watchdog**: Überwacht minVol, SOC, hausPower, Astro-Zeiten
  - **MinVol-Check**: Nur bei aktiver Last (Laden/Entladen > 0W)
  - **Verhindert False-Positives**: Kein Alarm wenn Akku im Standby steht (z.B. nachts leer)
  - Alarm bei längerem Ausfall kritischer Sensoren + Discord-Benachrichtigung

### Sensor-Daten Validierung
Alle Eingangsdaten werden auf plausible Bereiche geprüft:
- **SOC**: 0-100% (Fallback: 50%)
- **minVol**: 2.5-4.0V (Fallback: 3.5V)
- **hausPower**: -10kW bis +10kW (Fallback: 0W)
- **Sunrise/Sunset**: HH:MM Format validiert (Fallback: 06:00/18:00)
- **Pack-Voltages**: 2.5-4.0V, ungültige Werte werden übersprungen

Bei korrupten/fehlenden Sensordaten werden sichere Fallback-Werte verwendet und Warnings geloggt. Verhindert Script-Crashes bei Sensor-Ausfällen.

## 📊 Status-Anzeige

Status-Datenpunkte in `0_userdata.0.Zendure.Status/`:

- `Modus_Aktuell`: Aktueller Modus mit Details (optimiert für UI-Statusbalken)
  - Beispiele: `Sonnenzeit: Laden`, `Sonnenzeit: Laden (Akku-Leer)`, `Manuell: 900W`
  - Gekürzte Texte für bessere Darstellung in VIS/Node-RED
- `Akku_Leer`: Entladestopp aktiv (true/false)
- `Akku_Voll_Tag`: 100% SOC, Tag-Entladen aktiv (true/false)
- `Watchdog_Alarm`: Sensor-Ausfall erkannt (String mit Details)
- `Modus_Wechsel_Aktiv`: Sanfter Modus-Übergang läuft (true/false)

Persist-DPs in `0_userdata.0.Zendure.Persist/`:
- `Error_Counter`: Anzahl Fehler seit letztem Reset
- `Last_Ladeleistung`: Letzte Ladeleistung (für Sticky Charging)
- `Notladen_Aktiv`: Notladen-Flag persistent
- `Last_AcMode`: Letzter acMode (für sanfte Übergänge)

## 🔧 Erweiterte Einstellungen

### Sticky Charging

Standardmäßig aktiv (empfohlen). Deaktivierbar über `Sticky_Charging_Aktiv`.

**Funktionsweise:**
- Ladeleistung **steigt sofort** bei PV-Überschuss
- Ladeleistung **fällt nur** wenn Netzbezug > Zielwert
- Verhindert nervöses Regelverhalten bei Wolken

## 📝 Logging

Multi-Level Logging System:

```javascript
const LOG_LEVEL = 2;  // Im User-Config-Block
```

- **0 = ERROR**: Nur kritische Fehler
- **1 = WARN**: Warnungen + Fehler
- **2 = INFO**: Standard-Betrieb (empfohlen)
- **3 = DEBUG**: Volle Details für Fehlersuche

**Log-Beispiele:**
```
ℹ️ INFO: Zeitplan: 5 Slot(s) aktiv (2 übersprungen)
⚠️ WARN: Zeitplan Slot 03: Leistung 1500W außerhalb 0-1200W - korrigiert auf 1200W
❌ ERROR: KRITISCH: 5 konsekutive Fehler - Script wird gestoppt!
🔍 DEBUG: Pack 1 (PACK_ID_1): 3.245V
```

## 📦 Changelog
### Version 2.0 STABLE (2025-12-26) 🛡️
**🔒 Kritische Sicherheits-Härtungen:**
- **Notfall-Bypass**: Notladen funktioniert IMMER - auch bei Script-Stop (Stop-Flag wird ignoriert bei kritischem minVol <= 3.0V)
- **Safe-Stop-Mechanismus**: Bei Error Counter >= 5 wird Device ERST auf Standby (0W/0W) gesetzt, DANN Stop-Flag
- **Kontinuierlicher Safe-Stop**: Bei gesetztem Stop-Flag wird jede Minute Device auf 0W/0W gesetzt (verhindert unbeabsichtigte Entladung)
- **Sicherer MinVol-Fallback**: Bei Sensor-Ausfall (NULL) → Fallback 2.0V statt 3.5V (erzwingt Notladen statt Weiter-Entladung)
- **Erweiterte MinVol-Range**: Akzeptiert kritische Werte unter 2.5V (vorher: Fallback auf 3.5V verhinderte Notladen)

**🔧 Verbesserungen:**
- Discord-Alarm "NOTFALL-NOTLADEN" wenn Stop=TRUE aber minVol kritisch
- Watchdog-Alarm bei MinVol-Sensor-Ausfall
- Detailliertes Logging bei Safe-Stop (welche Werte gesetzt werden)
- Log-Output: "🔋 MinVol: X.XXXV (Notladen bei <= 3.0V, Entladestopp bei <= 3.1V)" bei jedem Durchlauf

**🐛 Bugfix:**
- Verhindert Tiefentladung wenn Script durch Error Counter gestoppt wurde
- Alle Sicherheitsfunktionen bleiben auch bei Stop-Flag aktiv
### Version 2.01 (2025-12-23)
**🔔 Discord-Integration & UI-Verbesserungen:**

**Neue Features:**
- **Discord Push-Benachrichtigungen**:
  - Webhook-Integration mit `node-fetch` (ioBroker-kompatibel)
  - 5 konfigurierbare Event-Typen: Notladen, Akku-Leer, Watchdog, Fehler, Script-Stop
  - Spam-Schutz: 15 Minuten Cooldown zwischen gleichen Meldungen
  - Startup-Test: Sendet alle Benachrichtigungstypen beim Script-Start als Beispiele
  - Farb-codierte Embeds (Gelb/Rot/Dunkelrot) mit Emojis
  - Einzeln ein-/ausschaltbar per `DISCORD_NOTIFY`-Objekt

**Verbesserungen:**
- **Statusmeldungen gekürzt** (für UI-Statusbalken optimiert):
  - `Sonnenzeit: Akku-Leer (Laden PV-Überschuss)` → `Sonnenzeit: Laden (Akku-Leer)`
  - `Manuell-Laden: 900W (SOC 45%)` → `Manuell: 900W`
  - `Akku-Leer-Schutz (Nacht)` → `Akku-Leer (Nacht)`
  - Bessere Lesbarkeit in VIS/Node-RED/Grafana

- **Intelligenter MinVol-Watchdog**:
  - Prüft MinVol **nur bei aktiver Last** (inputLimit > 0 ODER outputLimit > 0)
  - Bei Standby (beide 0W): Timestamp aktualisieren, kein Alarm
  - **Verhindert False-Positives**: Kein Watchdog-Alarm mehr wenn Akku nachts leer im Standby steht
  - MinVol ändert sich bei Inaktivität minimal → ist normal, kein Sensor-Ausfall

**Technisch:**
- `sendDiscordNotification()` nutzt `node-fetch` statt `request` (ioBroker-Kompatibilität)
- `sendDiscordStartupTest()` sendet Testmeldungen ohne Spam-Schutz zu aktivieren
- Watchdog liest `setInputLimit` und `setOutputLimit` zur Last-Erkennung

### Version 2.00 VEREINFACHT (2025-12-21)
**🎯 Große Vereinfachung:**
- **Reduziert auf 2 Modi**: Nur noch Sonnenzeit + Manuell-Laden
  - Entfernt: Laden-Prio, Entladen-Prio, Wartung, Zeitplan, CT-Modus
- **Alle Sicherheitsfunktionen erhalten**: Notladen, Akku-Leer-Schutz, minVol-Überwachung
- **Wetter-adaptive Schwellwerte**: Automatische Umschaltung zwischen Normal/Schlechtwetter
- **Status-DP minVol_Schwelle**: Zeigt automatisch aktiven Schwellwert (3.1V/3.2V)
- **Entfernt**: CT-Schnellregelung, Zeitplan-Slots, 5 komplexe Modi
- **Codebase**: ~1300 Zeilen (vorher 1899), einfacher zu warten
- Ideal für: Nutzer die nur Sonnenzeit-Automatik mit gelegentlichem Manuell-Laden brauchen

### Version 1.02 (2025-12-21)
**🐛 Kritische Bugfixes:**
- **KRITISCH**: Akku-Leer-Schutz blockiert nur noch Entladen, nicht Laden (Tag)
  - Vorher: Akku-Leer-Flag blockierte sowohl Entladen ALS AUCH Laden → Spannung konnte nicht erholen
  - Neu: Tag erlaubt Laden (mit maxLadeleistung für schnelle Erholung), nur Nacht geht in Standby
- **KRITISCH**: BLOCK C (Tag-Entladen SOC 100%) prüft jetzt `!akkuLeer` vor Entladung
  - Verhindert Entladung trotz niedriger Spannung wenn SOC=100% (kann bei defekten Zellen vorkommen)
- **Laden-Beschleunigung bei Akku-Leer**: Lädt mit `maxLadeleistung` statt Netzbezug-Ziel für schnellere Spannungs-Erholung
- **akkuVollTag-Reset**: Erfolgt jetzt bei Sonnenuntergang (modusnunabhängig) statt nur in Sonnenzeit-Modus
  - Verhindert akkuVollTag bleibt nach Modus-Wechsel hängen
- **Zeitplan stoppt Laden bei SOC=100%**: Verhindert Energie-Verschwendung im Zeitplan-Modus
- **Alle Modi propagieren akkuVollTag**: Verhindert Verlust des Flags bei Modus-Wechseln
- **Flag-Synchronisation**: `akkuLeer`/`akkuVollTag` werden nach jedem `evaluateStep()` mit DPs synchronisiert

**🔧 Verbesserungen:**
- **Code-Deduplizierung**: `checkAkkuLeer()` Helper-Funktion eliminiert ~42 Zeilen duplizierte Entladestopp-Hysterese-Logik aus 6 Modi
- **akkuVollTag in weiteren Modi**: Manuell-Laden und Laden-Prio setzen jetzt `akkuVollTag` bei SOC=100% am Tag (nicht nur Sonnenzeit)
- **CT-Modus akkuLeer-Propagierung**: `dpAkkuLeer` wird jetzt korrekt propagiert statt hart auf `false` gesetzt
- Detailliertes Debug-Logging bei Akku-Leer-Flag-Übergängen (Schwellen, Hysterese, Status)
- Test-Konstanten hinzugefügt: `TEST_MINVOL_NORMAL`, `TEST_MINVOL_WARN`, `TEST_MINVOL_RECOVER` für Simulation

### Version 1.01 (2025-12-20)
**🔧 Verbesserungen:**
- Erhöhte Hysterese für Notladen/Entladestopp: 0.05V → 0.10V (bessere Akku-Erholung)
- Zeitplan-Validierung nur bei aktivem Zeitplan-Modus (verhindert Log-Spam)
- Klarere Unterscheidung zwischen Laden-Prio (nur PV) und Manuell-Laden (aktiv Netz)
- Duplicate Action Prevention: schreibt `setInputLimit`/`setOutputLimit`/`setAcMode` nur bei echter Änderung (±5W Toleranz)
- CT-Fallback & Logging: nutzt letztes gültiges OutputLimit bei Sensorfehlern, mit klarer Logmeldung

**Neu: Schreib-Toleranz (±W) konfigurierbar**
- Datenpunkt: `0_userdata.0.Zendure.Steuerung.Write_Toleranz_Watt`
- Wirkung: Unterdrückt wiederholte Schreibvorgänge auf `setInputLimit`/`setOutputLimit`, wenn der Unterschied zum Istwert innerhalb der Toleranz liegt.
- Empfehlung: 5–20W. `0` deaktiviert die Unterdrückung.
- Beispiel: Ist=302W, Soll=310W, Toleranz=±10W → kein Write; bei Soll=335W → Write (Δ=33W).

### Version 1.0 (Initial Release)
**✨ Neue Features:**
- **User-Config-Block**: Alle Einstellungen prominent am Script-Start (Zeilen 103-140)
- **Dynamische Pack-Erkennung**: Automatisch 1-4+ Packs, Warnings bei Fehlern
- **Wetter-adaptive Schwellwerte**: 4 konfigurierbare DPs (Normal/Schlecht für Notlade/Entladestopp)
- **Multi-Level Logging**: ERROR/WARN/INFO/DEBUG statt nur DEBUG-Flag
- **Zeitplan-Validierung**: HH:MM-Format, 0-1200W Range mit Auto-Korrektur
- **Sensor-Daten Validierung**: Strikte Bereichsprüfung (SOC 0-100%, minVol 2.5-4.0V, hausPower ±10kW)

### 🔧 Verbesserungen
- **checkNotladen() Helper**: ~80 Zeilen eingespart durch Deduplizierung
- **validateConfig()**: Zentrale Validierung für alle Steuerungs-DPs
- **Sanfte Modus-Übergänge**: 0W → acMode-Wechsel → neue Leistung (schont Hardware)
- **Error Recovery**: Auto-Stop nach 5 Fehlern, Reset nach 5min Ruhe
- **Pack-Alarm**: Watchdog-Alarm bei Pack-Überwachungsausfall
- **Astro-Fallbacks**: Sichere Defaults (06:00/18:00) bei fehlenden Sunrise/Sunset-Werten
- **Code-Optimierung**: ~180 Zeilen gespart (deprecated Code entfernt, Kommentare komprimiert)

## 🤝 Beitragen

Feedback und Verbesserungsvorschläge sind willkommen! 

## 📄 Lizenz

Dieses Projekt steht unter der [MIT Lizenz](LICENSE).

**Kurzfassung:**
- ✅ Freie Nutzung, Änderung und Weitergabe
- ✅ Kommerzielle Nutzung erlaubt
- ⚠️ Keine Garantie, Nutzung auf eigene Gefahr
- 📝 Copyright-Hinweis und Lizenz müssen erhalten bleiben

## ⚠️ Disclaimer

Dieses Script steuert dein Batteriesystem. Teste gründlich und überwache die ersten Tage aktiv. Keine Garantie für Schäden an Hardware oder Datenverlust. Nutzung auf eigene Gefahr.

---

**Version**: 2.01 | **Datum**: 2025-12-23
