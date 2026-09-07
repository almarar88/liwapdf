package app.alcode.editor;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.AlcodeLayoutCallback;
import android.print.AlcodeWriteCallback;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;

/**
 * HTML to PDF, the way Android does it.
 *
 * On the desktop this is Electron's printToPDF: a page is laid out offscreen
 * and written as PDF. Android has the same machinery behind a different door
 * — a WebView produces a PrintDocumentAdapter, and the adapter writes into a
 * file descriptor — so the app's whole document pipeline (the Word reader,
 * the page setup it recovers, the Arabic typography) reaches the phone
 * unchanged, rather than being replaced by a JavaScript PDF writer that
 * cannot shape Arabic.
 *
 * The page box the caller passes is the one the source document declared, in
 * points; PrintAttributes wants thousandths of an inch, and the margins are
 * already written into the page's own CSS, so the print attributes ask for no
 * further margin of their own.
 */
@CapacitorPlugin(name = "AlcodePrint")
public class AlcodePrintPlugin extends Plugin {

    private static final int POINTS_PER_INCH = 72;

    /** What to do once the page has loaded and its fonts have settled. */
    private interface Ready {
        void onReady(WebView webView);
    }

    @PluginMethod
    public void toPdf(PluginCall call) {
        final String html = call.getString("html", "");
        final String name = call.getString("name", "document");
        final Double width = call.getDouble("width");
        final Double height = call.getDouble("height");

        getActivity()
            .runOnUiThread(() -> {
                try {
                    load(html, webView -> writePdf(call, webView, name, width, height));
                } catch (Exception error) {
                    call.reject("print-failed", error);
                }
            });
    }

    /** The system print dialog, for sending a document to a real printer. */
    @PluginMethod
    public void print(PluginCall call) {
        final String html = call.getString("html", "");
        final String name = call.getString("name", "document");
        getActivity()
            .runOnUiThread(() -> {
                try {
                    load(
                        html,
                        webView -> {
                            PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                            if (manager == null) {
                                call.reject("print-failed", "no print service");
                                return;
                            }
                            manager.print(name, webView.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
                            JSObject result = new JSObject();
                            result.put("printed", true);
                            call.resolve(result);
                        }
                    );
                } catch (Exception error) {
                    call.reject("print-failed", error);
                }
            });
    }

    /**
     * Loads the page into a WebView that can reach nothing.
     *
     * The document is already sanitised before it gets here, but a printed
     * document must not be able to reach the network under any circumstances,
     * so every request the page makes is refused outright — the same promise
     * the desktop app makes with its offscreen window.
     */
    private void load(String html, Ready ready) {
        WebView webView = new WebView(getContext());
        webView.getSettings().setJavaScriptEnabled(false);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.setWebViewClient(
            new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    String url = request.getUrl() == null ? "" : request.getUrl().toString();
                    if (url.startsWith("data:") || url.startsWith("about:")) return null;
                    return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    // Fonts settle a frame or two after the load event.
                    view.postDelayed(() -> ready.onReady(view), 250);
                }
            }
        );
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private void writePdf(PluginCall call, WebView webView, String name, Double widthPoints, Double heightPoints) {
        File output = null;
        try {
            PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(mediaSize(widthPoints, heightPoints))
                .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                // The document's own margins live in its CSS; asking for more
                // here would inset the page twice.
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();

            final PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
            output = File.createTempFile("alcode-print", ".pdf", getContext().getCacheDir());
            final File file = output;
            final ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(
                file,
                ParcelFileDescriptor.MODE_READ_WRITE
            );

            adapter.onLayout(
                null,
                attributes,
                new CancellationSignal(),
                new AlcodeLayoutCallback() {
                    @Override
                    public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                        adapter.onWrite(
                            new PageRange[] { PageRange.ALL_PAGES },
                            descriptor,
                            new CancellationSignal(),
                            new AlcodeWriteCallback() {
                                @Override
                                public void onWriteFinished(PageRange[] pages) {
                                    try {
                                        descriptor.close();
                                        JSObject result = new JSObject();
                                        result.put("base64", readBase64(file));
                                        call.resolve(result);
                                    } catch (Exception error) {
                                        call.reject("print-failed", error);
                                    } finally {
                                        file.delete();
                                    }
                                }

                                @Override
                                public void onWriteFailed(CharSequence reason) {
                                    file.delete();
                                    call.reject("print-failed", String.valueOf(reason));
                                }

                                @Override
                                public void onWriteCancelled() {
                                    file.delete();
                                    call.reject("print-failed", "cancelled");
                                }
                            }
                        );
                    }

                    @Override
                    public void onLayoutFailed(CharSequence reason) {
                        file.delete();
                        call.reject("print-failed", String.valueOf(reason));
                    }

                    @Override
                    public void onLayoutCancelled() {
                        file.delete();
                        call.reject("print-failed", "cancelled");
                    }
                },
                new Bundle()
            );
        } catch (Exception error) {
            if (output != null) output.delete();
            call.reject("print-failed", error);
        }
    }

    /** The page the document asked for, or ISO A4 when it did not say. */
    private PrintAttributes.MediaSize mediaSize(Double widthPoints, Double heightPoints) {
        if (widthPoints == null || heightPoints == null || widthPoints <= 0 || heightPoints <= 0) {
            return PrintAttributes.MediaSize.ISO_A4;
        }
        int widthMils = (int) Math.round((widthPoints / POINTS_PER_INCH) * 1000);
        int heightMils = (int) Math.round((heightPoints / POINTS_PER_INCH) * 1000);
        return new PrintAttributes.MediaSize("alcode", "Document", widthMils, heightMils);
    }

    private String readBase64(File file) throws Exception {
        try (InputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int read;
            while ((read = input.read(chunk)) != -1) buffer.write(chunk, 0, read);
            return Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP);
        }
    }
}
