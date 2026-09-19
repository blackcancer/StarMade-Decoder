/**
 * Independent JDK wire oracle for Java modified UTF, Tag envelopes and block words.
 * No StarMade source code or assets are embedded in this fixture.
 * Run through scripts/check-java-interop.mjs with a JDK 21 or newer.
 */
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class WireOracle {
    private static final String[] VALUES = {
        "", "ASCII", "\u0000", "\u00e9\u4e2d", "\ud83d\ude80", "\ud800",
        "x".repeat(65535), "\u0000".repeat(32767)
    };
    private static String units(String value) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < value.length(); i++) out.append(String.format("%04x", (int) value.charAt(i)));
        return out.toString();
    }
    public static void main(String[] args) throws Exception {
        Path dir = Path.of(args[1]);
        if (args[0].equals("generate")) {
            for (int i = 0; i < VALUES.length; i++) {
                try (DataOutputStream out = new DataOutputStream(Files.newOutputStream(dir.resolve("java-utf-" + i)))) {
                    out.writeUTF(VALUES[i]);
                }
            }
            ByteArrayOutputStream raw = new ByteArrayOutputStream();
            try (DataOutputStream out = new DataOutputStream(raw)) {
                out.writeByte(8); out.writeUTF("name\u0000\ud800"); out.writeUTF("value\ud83d\ude80\u0000");
            }
            byte[] tag = raw.toByteArray();
            try (DataOutputStream out = new DataOutputStream(Files.newOutputStream(dir.resolve("java-tag")))) {
                out.writeShort(17); out.write(tag);
            }
            try (GZIPOutputStream out = new GZIPOutputStream(Files.newOutputStream(dir.resolve("java-tag-gzip")))) { out.write(tag); }
            ByteBuffer words = ByteBuffer.allocate(4 * 32768).order(ByteOrder.LITTLE_ENDIAN);
            for (int i = 0; i < 32768; i++) words.putInt((i & 8191) | ((i & 127) << 13) | ((i & 1) << 20) | ((i & 31) << 21) | ((i & 63) << 26));
            Files.write(dir.resolve("java-block-words"), words.array());
        } else if (args[0].equals("verify")) {
            for (int i = 0; i < VALUES.length; i++) {
                try (DataInputStream in = new DataInputStream(Files.newInputStream(dir.resolve("js-utf-" + i)))) {
                    if (!in.readUTF().equals(VALUES[i]) || in.read() != -1) throw new AssertionError("UTF " + i);
                }
            }
            try (DataInputStream in = new DataInputStream(Files.newInputStream(dir.resolve("js-tag")))) {
                if (in.readShort() != 0 || in.readByte() != 8 || !in.readUTF().equals("name\u0000\ud800") ||
                    !in.readUTF().equals("value\ud83d\ude80\u0000") || in.read() != -1) throw new AssertionError("Tag");
            }
            System.out.println("Java accepted all SDK UTF strings and the SDK STRING Tag.");
        } else if (args[0].equals("malformed")) {
            for (String hex : List.of("0002c241", "0003e28241", "0003e24180", "0001c2", "0002e280", "0004f09f9880")) {
                try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(HexFormat.of().parseHex(hex)))) {
                    in.readUTF(); throw new AssertionError("Java unexpectedly accepted " + hex);
                } catch (UTFDataFormatException expected) { }
            }
            System.out.println("Java rejected all malformed modified UTF fixtures.");
        } else throw new IllegalArgumentException("Unknown mode: " + args[0]);
    }
}
