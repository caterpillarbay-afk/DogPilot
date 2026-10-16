// Android-App (android/): stellt window.DogPilotAndroid bereit – Ansagen über den Navi-Kanal,
// Bildschirm wach halten, Datei speichern, Teilen. Im Browser ist native null.
export const native = (typeof window !== 'undefined' && window.DogPilotAndroid) || null;

// Download der App für Android-Nutzer im Browser
export const APK_URL = 'https://github.com/caterpillarbay-afk/DogPilot/releases/latest/download/DogPilot.apk';
export const offerApp = () => !native && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
