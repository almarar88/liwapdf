package app.alcode.editor;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The two capabilities the desktop app gets from Electron: turning a
        // document into a PDF, and putting a finished file where the user can
        // find it. Registered before the bridge starts so the web layer never
        // sees a half-built platform.
        registerPlugin(AlcodePrintPlugin.class);
        registerPlugin(AlcodeFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
