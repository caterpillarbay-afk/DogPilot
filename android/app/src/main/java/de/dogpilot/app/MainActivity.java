package de.dogpilot.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * DogPilot als Android-App: zeigt die Web-App an und übernimmt, was der Browser nicht kann –
 * vor allem Ansagen über den Navi-Kanal, damit sie über Android Auto auch bei laufendem Radio kommen.
 * Alles andere (Planung, Daten, Updates) kommt unverändert von der Web-App.
 */
public class MainActivity extends Activity {
    static final String APP_URL = "https://dogpilot.caterpillar-bay.workers.dev/";
    static final String APP_HOST = Uri.parse(APP_URL).getHost();
    static final int REQ_LOCATION = 1, REQ_FILE = 2, REQ_SAVE = 3;

    WebView web;
    TextToSpeech tts;
    boolean ttsReady;
    AudioManager audio;
    AudioFocusRequest focus;
    GeolocationPermissions.Callback geoCallback;
    String geoOrigin;
    ValueCallback<Uri[]> fileCallback;
    String pendingSave;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.parseColor("#0a1615"));
        getWindow().setNavigationBarColor(Color.parseColor("#0a1615"));
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) tts.setLanguage(Locale.GERMANY);
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { if (!tts.isSpeaking()) releaseFocus(); }
            @Override public void onError(String id) { if (!tts.isSpeaking()) releaseFocus(); }
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0a1615"));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(), "DogPilotAndroid");

        web.setWebViewClient(new WebViewClient() {
            // Eigene Seiten in der App, alles andere (Mail, Google Maps, Quellen-Links) in der passenden App
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                if (APP_HOST.equals(uri.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException e) { toast("Keine App zum Öffnen gefunden"); }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLocation()) {
                    cb.invoke(origin, true, false);
                } else {
                    geoOrigin = origin;
                    geoCallback = cb;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                // Eigener Intent statt params.createIntent(): der übernimmt nur den ersten accept-Eintrag
                // (".json" ist kein Dateityp – dann wäre nichts wählbar). JSON-Dateien melden manche
                // Dateimanager als „unbekannt“, daher für alles außer Bildern */*.
                boolean images = false;
                for (String t : params.getAcceptTypes()) if (t != null && t.startsWith("image/")) images = true;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType(images ? "image/*" : "*/*");
                try {
                    startActivityForResult(pick, REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (state == null || web.restoreState(state) == null) web.loadUrl(APP_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_LOCATION && geoCallback != null) {
            geoCallback.invoke(geoOrigin, hasLocation(), false);   // auch „ungefähr“ (Android 12+) reicht
            geoCallback = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        } else if (code == REQ_SAVE) {
            if (result == RESULT_OK && data != null && data.getData() != null && pendingSave != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    out.write(pendingSave.getBytes(StandardCharsets.UTF_8));
                    toast("Sicherung gespeichert");
                } catch (Exception e) {
                    toast("Sicherung konnte nicht gespeichert werden");
                }
            }
            pendingSave = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        tts.shutdown();
        web.destroy();
        super.onDestroy();
    }

    boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_SHORT).show());
    }

    void releaseFocus() {
        if (focus != null) { audio.abandonAudioFocusRequest(focus); focus = null; }
    }

    /** Aufrufe aus der Web-App (window.DogPilotAndroid) */
    class Bridge {
        @JavascriptInterface
        public boolean ready() { return ttsReady; }

        @JavascriptInterface
        public String version() { return BuildConfigInfo.version(MainActivity.this); }

        // channel: "nav" = Navi-Kanal (Android Auto, über Radio/Musik gelegt), "media" = wie Musik
        @JavascriptInterface
        public void speak(String text, String channel) {
            if (!ttsReady) { toast("Sprachausgabe nicht bereit"); return; }
            boolean nav = !"media".equals(channel);
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(nav ? AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE : AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            // Andere Töne (Musik, Radio über Android Auto) für die Ansage leiser stellen
            releaseFocus();
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).build();
            audio.requestAudioFocus(focus);
            tts.setAudioAttributes(attrs);
            tts.speak(text, TextToSpeech.QUEUE_ADD, null, "dp" + System.nanoTime());
        }

        @JavascriptInterface
        public void stop() { tts.stop(); releaseFocus(); }

        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        // Datei speichern (Sicherung): Android fragt, wohin
        @JavascriptInterface
        public void saveFile(String name, String mime, String content) {
            pendingSave = content;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name);
            runOnUiThread(() -> startActivityForResult(i, REQ_SAVE));
        }

        @JavascriptInterface
        public void share(String title, String text) {
            Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(i, title)));
        }
    }
}
