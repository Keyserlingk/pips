package io.github.keyserlingk.pips;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.util.Collections;
import org.junit.Test;

/** The scanner's decoding, fed frames laid out the way the camera delivers them. */
public class QrScannerPluginTest {

    private static final int WIDTH = 1280, HEIGHT = 720, ROW_STRIDE = 1344; // rows padded, as on real cameras

    /** A grey camera frame with the code drawn in the middle, `size` pixels square, slightly washed out. */
    private static byte[] frame(String text, int size) throws Exception {
        BitMatrix code = new QRCodeWriter()
            .encode(text, BarcodeFormat.QR_CODE, size, size, Collections.singletonMap(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.L));
        byte[] luma = new byte[ROW_STRIDE * HEIGHT];
        java.util.Arrays.fill(luma, (byte) 110);
        int left = (WIDTH - size) / 2, top = (HEIGHT - size) / 2;
        for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) luma[(top + y) * ROW_STRIDE + left + x] = (byte) (code.get(x, y) ? 40 : 215);
        return luma;
    }

    private static String scan(byte[] luma) {
        MultiFormatReader reader = QrScannerPlugin.qrReader();
        return QrScannerPlugin.decode(reader, luma, ROW_STRIDE, WIDTH, HEIGHT);
    }

    @Test
    public void readsShortSeedLinks() throws Exception {
        String link = "https://keyserlingk.github.io/pips/#/s/1.e.1hdg1mp.1ha1kmh";
        assertEquals(link, scan(frame(link, 300)));
    }

    @Test
    public void readsDenseWholePuzzleLinks() throws Exception {
        StringBuilder link = new StringBuilder("https://keyserlingk.github.io/pips/#/p/z");
        while (link.length() < 460) link.append("eJyN0k1rwkAQhv9KyZ5e");
        assertEquals(link.toString(), scan(frame(link.toString(), 520)));
    }

    @Test
    public void findsNothingInAnEmptyFrame() {
        assertNull(scan(new byte[ROW_STRIDE * HEIGHT]));
    }
}
