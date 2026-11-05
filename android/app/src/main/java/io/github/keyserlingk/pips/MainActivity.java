package io.github.keyserlingk.pips;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin (not from npm), so it has to be registered here.
        registerPlugin(QrScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
