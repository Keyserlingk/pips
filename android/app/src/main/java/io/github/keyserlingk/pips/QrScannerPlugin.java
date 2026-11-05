package io.github.keyserlingk.pips;

import android.Manifest;
import android.graphics.Color;
import android.util.Size;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.NotFoundException;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Scans QR codes for the app: the back camera (CameraX, with the camera's own autofocus) is shown
 * behind the transparent web view, and every frame goes to ZXing, a small QR reader with no native
 * code. Each code read is sent to the page as a "qrScanned" event; the page decides what to do.
 */
@CapacitorPlugin(name = "QrScanner", permissions = { @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera") })
public class QrScannerPlugin extends Plugin {

    private final ExecutorService analysis = Executors.newSingleThreadExecutor();
    private final MultiFormatReader reader = qrReader();
    private PreviewView previewView;
    private ProcessCameraProvider cameras;

    /** ZXing set up for QR codes only, looking hard (frames come fast enough to afford it). */
    static MultiFormatReader qrReader() {
        Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.POSSIBLE_FORMATS, Collections.singletonList(BarcodeFormat.QR_CODE));
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        MultiFormatReader reader = new MultiFormatReader();
        reader.setHints(hints);
        return reader;
    }

    /**
     * The QR code in a camera frame's brightness plane, or null. Rows are rowStride bytes apart
     * (cameras often pad them beyond the width).
     */
    static String decode(MultiFormatReader reader, byte[] luma, int rowStride, int width, int height) {
        PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(luma, rowStride, height, 0, 0, width, height, false);
        try {
            Result result = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source)));
            return result.getText();
        } catch (NotFoundException e) {
            return null;
        } finally {
            reader.reset();
        }
    }

    @PluginMethod
    public void startScan(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermission");
            return;
        }
        start(call);
    }

    @PermissionCallback
    private void cameraPermission(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) start(call);
        else call.reject("Pips needs the camera to scan. Allow camera access and try again.", "PERMISSION_DENIED");
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stop();
            call.resolve();
        });
    }

    private void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (previewView == null) {
                previewView = new PreviewView(getActivity());
                previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
                previewView.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                ((ViewGroup) getBridge().getWebView().getParent()).addView(previewView, 0);
            }
            getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
            ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(getContext());
            future.addListener(
                () -> {
                    try {
                        cameras = future.get();
                        bind();
                        call.resolve();
                    } catch (Exception e) {
                        stop();
                        call.reject("Could not start the camera.", e);
                    }
                },
                ContextCompat.getMainExecutor(getContext())
            );
        });
    }

    private void bind() {
        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());
        // A sharp picture for dense codes; the camera picks its closest size.
        ResolutionSelector sharp = new ResolutionSelector.Builder()
            .setResolutionStrategy(new ResolutionStrategy(new Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build();
        ImageAnalysis frames = new ImageAnalysis.Builder()
            .setResolutionSelector(sharp)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();
        frames.setAnalyzer(analysis, this::read);
        cameras.unbindAll();
        cameras.bindToLifecycle(getActivity(), CameraSelector.DEFAULT_BACK_CAMERA, preview, frames);
    }

    /** Looks for a QR code in one frame's brightness (the Y plane): all ZXing needs. */
    private void read(ImageProxy image) {
        try {
            ImageProxy.PlaneProxy plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer();
            byte[] luma = new byte[buffer.remaining()];
            buffer.get(luma);
            String text = decode(reader, luma, plane.getRowStride(), image.getWidth(), image.getHeight());
            if (text != null) {
                JSObject event = new JSObject();
                event.put("text", text);
                notifyListeners("qrScanned", event);
            }
        } catch (Exception e) {
            // A damaged or partial read: try the next frame.
        } finally {
            image.close();
        }
    }

    private void stop() {
        if (cameras != null) cameras.unbindAll();
        if (previewView != null) {
            ((ViewGroup) previewView.getParent()).removeView(previewView);
            previewView = null;
        }
        getBridge().getWebView().setBackgroundColor(Color.WHITE);
    }

    @Override
    protected void handleOnDestroy() {
        if (cameras != null) cameras.unbindAll();
        analysis.shutdown();
    }
}
