package app.alcode.editor;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Where a produced file goes, and how a shared one comes in.
 *
 * On a phone a saved document belongs in Downloads, where every other app
 * puts what it makes and where the user knows to look — not inside the app's
 * private storage, which is invisible without a file manager and vanishes
 * when the app is uninstalled. MediaStore is the supported route on Android
 * 10 and later and needs no storage permission at all; older versions get the
 * public Downloads directory directly.
 *
 * The other direction matters just as much: a document opened from Gmail or
 * shared from Drive arrives as a content URI this app has one-shot permission
 * to read, so it is read straight into memory before that permission lapses.
 */
@CapacitorPlugin(name = "AlcodeFiles")
public class AlcodeFilesPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String name = call.getString("name", "document");
        String base64 = call.getString("base64", "");
        String mime = call.getString("mime", "application/octet-stream");
        byte[] data = Base64.decode(base64, Base64.DEFAULT);

        try {
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver resolver = getContext().getContentResolver();
                uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("save-failed", "no download entry");
                    return;
                }
                try (OutputStream output = resolver.openOutputStream(uri)) {
                    if (output == null) {
                        call.reject("save-failed", "no output stream");
                        return;
                    }
                    output.write(data);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
            } else {
                File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloads.exists() && !downloads.mkdirs()) {
                    call.reject("save-failed", "cannot reach Downloads");
                    return;
                }
                File file = uniqueFile(downloads, name);
                try (FileOutputStream output = new FileOutputStream(file)) {
                    output.write(data);
                }
                uri = androidx.core.content.FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
                );
            }

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            result.put("display", "Downloads/" + name);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("save-failed", error);
        }
    }

    @PluginMethod
    public void readUri(PluginCall call) {
        String uri = call.getString("uri", "");
        try {
            JSObject result = read(Uri.parse(uri));
            if (result == null) {
                call.reject("read-failed", "cannot open " + uri);
                return;
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("read-failed", error);
        }
    }

    /**
     * The document the app was launched with, read once.
     *
     * Android hands the intent to the activity, not to the web layer, so the
     * renderer has no way to ask for it other than this.
     */
    @PluginMethod
    public void takeIntentFile(PluginCall call) {
        try {
            Intent intent = getActivity().getIntent();
            Uri uri = null;
            if (intent != null) {
                if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
                else if (Intent.ACTION_SEND.equals(intent.getAction())) {
                    uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                }
            }
            if (uri == null) {
                call.resolve(new JSObject());
                return;
            }
            JSObject result = read(uri);
            // Taken: a second call must not reopen the same document.
            if (intent != null) {
                intent.setData(null);
                intent.removeExtra(Intent.EXTRA_STREAM);
                intent.setAction(Intent.ACTION_MAIN);
            }
            call.resolve(result == null ? new JSObject() : result);
        } catch (Exception error) {
            call.resolve(new JSObject());
        }
    }

    private JSObject read(Uri uri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) return null;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[32 * 1024];
            int read;
            while ((read = input.read(chunk)) != -1) buffer.write(chunk, 0, read);
            JSObject result = new JSObject();
            result.put("name", displayName(uri));
            result.put("base64", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            return result;
        }
    }

    private String displayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (column >= 0) {
                        String name = cursor.getString(column);
                        if (name != null && !name.isEmpty()) return name;
                    }
                }
            } catch (Exception ignored) {
                // Fall through to the path's last segment.
            }
        }
        String path = uri.getLastPathSegment();
        if (path == null) return "document";
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    /** "report.pdf", then "report (2).pdf": never overwrite what is there. */
    private File uniqueFile(File directory, String name) {
        File file = new File(directory, name);
        if (!file.exists()) return file;
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String extension = dot > 0 ? name.substring(dot) : "";
        for (int index = 2; index < 999; index += 1) {
            File candidate = new File(directory, stem + " (" + index + ")" + extension);
            if (!candidate.exists()) return candidate;
        }
        return file;
    }
}
