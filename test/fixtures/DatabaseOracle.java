/**
 * Independent JDK HashMap<String,Boolean> oracle for Fleet.serializeRemotes.
 * Fleet's pinned reference is StarMade-Open decf3a1990f29b9505041f122188bf19489bcf7e.
 * No game source is needed: ObjectOutputStream/ObjectInputStream define the bytes.
 */
import java.io.*;
import java.nio.file.*;
import java.util.*;

public final class DatabaseOracle {
    private static HashMap<String, Boolean> values(int id) {
        HashMap<String, Boolean> result = new HashMap<>();
        if (id == 0) return result;
        String[] keys = {"", "dot.name", "slash/name", "value", "nul\u0000", "rocket\ud83d\ude80", "lone\ud800", "x".repeat(65535)};
        for (int i = 0; i < keys.length; i++) result.put(keys[i], i % 2 == 0);
        return result;
    }
    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[1]);
        for (int id = 0; id < 2; id++) {
            if (args[0].equals("generate")) {
                try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(directory.resolve("java-map-" + id)))) {
                    out.writeObject(values(id));
                }
            } else if (args[0].equals("verify")) {
                try (ObjectInputStream in = new ObjectInputStream(Files.newInputStream(directory.resolve("sdk-map-" + id)))) {
                    Object value = in.readObject();
                    if (!(value instanceof HashMap<?, ?>) || !values(id).equals(value) || in.read() != -1) throw new AssertionError("Map " + id);
                }
            } else throw new IllegalArgumentException("Unknown mode");
        }
        System.out.println("JDK database maps " + args[0] + " passed (empty and UTF/handle boundary map).");
    }
}
