import java.io.BufferedReader;
import java.io.InputStreamReader;

public class Echo {
    public static void main(String[] args) {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        for (;;) {
            String line = br.readLine();
            if (line == null) break;
            System.out.println("got: " + line);
        }
    }
}
