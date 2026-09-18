/**
 * Independent JDK oracle for Java Modified UTF-8 interoperability tests.
 * The test protocol uses hexadecimal UTF-16 units to preserve lone surrogates.
 */
import java.io.*;
import java.util.HexFormat;

public final class JavaUtfReference {
    public static void main(String[] args) throws Exception {
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = input.readLine()) != null) {
            try {
                String payload = line.substring(2);
                if (line.startsWith("E ")) {
                    StringBuilder text = new StringBuilder();
                    for (int i = 0; i < payload.length(); i += 4) {
                        text.append((char) Integer.parseInt(payload.substring(i, i + 4), 16));
                    }
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    new DataOutputStream(bytes).writeUTF(text.toString());
                    System.out.println(HexFormat.of().formatHex(bytes.toByteArray()));
                } else {
                    String text = new DataInputStream(new ByteArrayInputStream(HexFormat.of().parseHex(payload))).readUTF();
                    StringBuilder units = new StringBuilder();
                    for (int i = 0; i < text.length(); i++) units.append(String.format("%04x", (int) text.charAt(i)));
                    System.out.println(units);
                }
            } catch (IOException exception) {
                System.out.println("ERROR:" + exception.getClass().getSimpleName());
            }
        }
    }
}
