package android.print;

/**
 * A subclassable LayoutResultCallback.
 *
 * The framework declares this callback's constructor package-private, so no
 * class outside `android.print` can extend it — and creating a PDF from a
 * WebView requires exactly that. Declaring one public subclass inside the
 * same package is the supported way through: it adds no behaviour and grants
 * no access beyond the callback itself.
 */
public abstract class AlcodeLayoutCallback extends PrintDocumentAdapter.LayoutResultCallback {
}
