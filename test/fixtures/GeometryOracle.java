/**
 * Independent JDK float/int oracle for SINGLE_SIDE_EDGE region records.
 *
 * Algorithm provenance: blackcancer/StarMade-Open commit
 * decf3a1990f29b9505041f122188bf19489bcf7e,
 * SegmentDataSingleSideEdge.isInSide and IcosahedronHelper.isPointInSide.
 * This small standalone harness implements their arithmetic contract using
 * Java int overflow and float operations. It does not import the game classes,
 * redistribute game assets, or qualify a running game or later game versions.
 * Synthetic normals exercise oblique planes, cancellation, underflow and
 * overflow; callers still need their installation's IcoVectors.bin normals.
 */
import java.io.*;
import java.nio.file.*;

public final class GeometryOracle {
    private static final int BLOCKS = 32768;
    private static final int WORD = 37 | (93 << 13) | (1 << 20) | (17 << 21) | (42 << 26);
    private static final float[][][] NORMALS = {
        {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}},
        {{1, -1, .25f}, {-.125f, 1, .75f}, {.5f, .125f, -1}},
        {{1, -1, Math.ulp(1f)}, {1, -1, -Math.ulp(1f)}, {0, 1, 1}},
        {{Float.MIN_VALUE, 0, 0}, {0, Float.MIN_NORMAL, 0}, {0, 0, Float.MIN_VALUE}},
        {{Float.MAX_VALUE, Float.MAX_VALUE, -Float.MAX_VALUE}, {1, 0, 0}, {0, 1, 0}}
    };
    private static final int[][] POSITIONS = {
        {0, 0, 0}, {32, -32, 64}, {-32, 64, -64},
        {16777216, -16777216, 0}, {16777248, 16777248, -16777248},
        {Integer.MIN_VALUE, 0, 0}, {2147483616, Integer.MIN_VALUE, 32}
    };

    private static boolean inside(int index, int[] position, float[][] normals) {
        // The sums intentionally overflow as int before conversion to float.
        float x = (index & 31) - 16 + position[0];
        float y = ((index >> 5) & 31) - 16 + position[1];
        float z = ((index >> 10) & 31) - 16 + position[2];
        for (float[] n : normals) {
            if (!(n[0] * x + n[1] * y + n[2] * z > 0f)) return false;
        }
        return true;
    }

    private static void region(Path file, int[] position) throws IOException {
        int cell = (((position[0] >> 5) + 8) & 15)
            + ((((position[1] >> 5) + 8) & 15) << 4)
            + ((((position[2] >> 5) + 8) & 15) << 8);
        try (DataOutputStream out = new DataOutputStream(Files.newOutputStream(file))) {
            out.writeByte(7); out.write(new byte[3]);
            for (int i = 0; i < 4096; i++) {
                out.writeShort(i == cell ? 1 : 0);
                out.writeShort(i == cell ? 26 : 0);
            }
            out.writeByte(7); out.writeLong(123456789L);
            for (int coordinate : position) out.writeInt(coordinate);
            out.writeByte(5); out.writeInt(WORD);
        }
    }

    public static void main(String[] args) throws IOException {
        Path directory = Path.of(args[0]);
        int count = NORMALS.length * POSITIONS.length;
        try (DataOutputStream out = new DataOutputStream(Files.newOutputStream(directory.resolve("geometry.bin")))) {
            out.writeInt(count);
            int id = 0;
            for (float[][] normals : NORMALS) {
                for (int[] position : POSITIONS) {
                    for (float[] normal : normals) for (float component : normal) out.writeFloat(component);
                    for (int coordinate : position) out.writeInt(coordinate);
                    for (int index = 0; index < BLOCKS; index++) out.writeBoolean(inside(index, position, normals));
                    region(directory.resolve("region-" + id++ + ".smd3"), position);
                }
            }
        }
        System.out.println("Java geometry fixtures: " + count + " regions, " + (count * BLOCKS) + " block positions.");
    }
}
