package com.canteen.ordering.controller;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Exposes the canteen URL on the local network and generates a QR code
 * that points students to the menu on their phones.
 */
@RestController
@RequestMapping("/api")
public class QrController {

    private static final Logger log = LoggerFactory.getLogger(QrController.class);

    private final int port;

    public QrController(@Value("${server.port:8080}") int port) {
        this.port = port;
    }

    @GetMapping("/network-info")
    public Map<String, Object> networkInfo(HttpServletRequest request) {
        String menuUrl = resolveMenuUrl(request);
        String host = URI.create(menuUrl).getHost();
        if (host == null) {
            host = "localhost";
        }

        Map<String, Object> info = new LinkedHashMap<>();
        info.put("lanIp", host);
        info.put("port", port);
        info.put("menuUrl", menuUrl);
        info.put("isLocalhost", "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host));
        info.put("qrUrl", "/api/qr?size=360&url=" + urlEncode(menuUrl));
        return info;
    }

    @GetMapping(value = "/qr", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> qrCode(@RequestParam(required = false) String url,
                                         @RequestParam(defaultValue = "320") int size,
                                         HttpServletRequest request)
            throws IOException, WriterException {

        String content = (url == null || url.isBlank())
                ? resolveMenuUrl(request)
                : url.trim();

        validateUrl(content);
        int dimension = Math.max(160, Math.min(size, 600));

        Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
        hints.put(EncodeHintType.CHARACTER_SET, StandardCharsets.UTF_8.name());
        hints.put(EncodeHintType.MARGIN, 1);

        BitMatrix matrix = new QRCodeWriter()
                .encode(content, BarcodeFormat.QR_CODE, dimension, dimension, hints);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        MatrixToImageWriter.writeToStream(matrix, "PNG", out);

        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .body(out.toByteArray());
    }

    private void validateUrl(String content) {
        if (content.length() > 500) {
            throw new IllegalArgumentException("QR content is too long.");
        }
        URI uri;
        try {
            uri = URI.create(content);
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("QR url must be a valid http(s) URL.");
        }
        String scheme = uri.getScheme();
        if (scheme == null
                || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                || uri.getHost() == null) {
            throw new IllegalArgumentException("QR url must start with http:// or https://.");
        }
    }

    /**
     * Behind Render (or any reverse proxy) build the public URL from the
     * forwarded headers instead of the container's private IP address.
     */
    private String resolveMenuUrl(HttpServletRequest request) {
        String forwardedHost = firstHeaderValue(request.getHeader("X-Forwarded-Host"));
        String forwardedProto = firstHeaderValue(request.getHeader("X-Forwarded-Proto"));

        if (forwardedHost != null || forwardedProto != null) {
            String host = forwardedHost != null ? forwardedHost : request.getHeader("Host");
            if (host != null && !host.isBlank()) {
                String scheme = forwardedProto == null ? "https" : forwardedProto.toLowerCase(Locale.ROOT);
                return scheme + "://" + host.trim() + "/";
            }
        }

        String lanIp = findLanAddress().orElse("localhost");
        return "http://" + lanIp + ":" + port + "/";
    }

    private static String firstHeaderValue(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.split(",")[0].trim();
    }

    private Optional<String> findLanAddress() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            List<Candidate> candidates = new ArrayList<>();

            while (interfaces.hasMoreElements()) {
                NetworkInterface networkInterface = interfaces.nextElement();
                if (!networkInterface.isUp() || networkInterface.isLoopback()) {
                    continue;
                }
                String name = networkInterface.getName().toLowerCase(Locale.ROOT);
                Enumeration<InetAddress> addresses = networkInterface.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address
                            && !address.isLoopbackAddress()
                            && !address.isLinkLocalAddress()) {
                        candidates.add(new Candidate(name, address.getHostAddress()));
                    }
                }
            }

            return candidates.stream()
                    .max(Comparator.comparingInt(c -> score(c.name(), c.ip())))
                    .map(Candidate::ip);
        } catch (SocketException ex) {
            log.warn("Could not inspect network interfaces: {}", ex.getMessage());
        }
        return Optional.empty();
    }

    private int score(String interfaceName, String ip) {
        int score = 0;
        if (interfaceName.startsWith("en")) {
            score += 20;
        } else if (interfaceName.startsWith("wlan") || interfaceName.startsWith("wi-fi")) {
            score += 18;
        } else if (interfaceName.startsWith("eth")) {
            score += 10;
        }

        if (ip.startsWith("192.168.")) {
            score += 6;
        } else if (ip.startsWith("10.")) {
            score += 3;
        } else if (ip.startsWith("172.")) {
            score += 2;
        }
        return score;
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private record Candidate(String name, String ip) {
    }
}
