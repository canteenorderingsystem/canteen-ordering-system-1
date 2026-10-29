# Kain Na! — Canteen Ordering System

A full-stack canteen ordering system with a warm, modern student menu and a
dark "kitchen display" POS dashboard. Built with Spring Boot, H2, and plain
HTML/CSS/JavaScript — no frontend framework or build step.

- **Students** browse the menu, build a tray, and place an order to get a queue number.
- **Kitchen staff** watch the queue live, move tickets from *Pending → Preparing → Ready → Served*, and cancel orders if needed.
- **QR code** on the menu page lets a phone on the same Wi-Fi open the site instantly.

---

## Requirements

- **Java 17 or newer** (tested on Java 26)
- No Maven install needed — the project includes the Maven Wrapper (`./mvnw`)
- Internet access on the first run so Maven can download dependencies
- Optional: internet access in the browser for Google Fonts (food photos are stored locally in `static/images/`)

---

## Run it

From the project root:

```bash
./mvnw spring-boot:run
```

Wait for `Started CanteenOrderingApplication` (the first run can take a while),
then open:

| Page | URL |
| --- | --- |
| Student menu | http://localhost:8080/ |
| Kitchen display | http://localhost:8080/kitchen.html |
| H2 database console | http://localhost:8080/h2-console/ |

### Or build a jar

```bash
./mvnw clean package
java -jar target/canteen-ordering-1.0.0.jar
```

### Or run with Docker

```bash
docker build -t canteen-ordering .
docker run --rm -p 8080:8080 -v "$PWD/data:/app/data" canteen-ordering
```

The container reads `PORT` (defaults to `8080`) and stores H2 data in
`/app/data`, so mount a volume there to keep orders across container restarts.

### Stop the app

Press `Ctrl+C` in the terminal running it.

---

## Using the app

### Student menu (`/`)

1. Filter by category or refresh the menu.
2. Press **Add to cart** on any dish. The cart stays on the right on desktop;
   on phones a cart bar appears at the bottom and opens a drawer.
3. Adjust quantities with the `−` / `+` steppers.
4. Optionally add your name and a note (for example, "no onions").
5. Press **Place order**. A confirmation shows your **queue number** and total.

The order also appears immediately on the kitchen dashboard.

### Kitchen display (`/kitchen.html`)

- **Auto-refreshes every 5 seconds**; new tickets get a "New" highlight, a toast, and an optional chime.
- Tabs: **Active**, Pending, Preparing, Ready, Completed, Cancelled, All.
- Search by queue number, customer name, or item.
- Each ticket has one main action:
  - **Start** — Pending → Preparing
  - **Ready** — Preparing → Ready
  - **Serve** — Ready → Completed
  - **Cancel** (×) — available until the order is completed or cancelled
- Stats cards show live counts and the next queue number.
- **Fullscreen** button for a wall-mounted display; sound can be muted.

---

## QR code & testing on a phone

The menu page generates a QR code automatically from the Mac's LAN IPv4
address, for example `http://192.168.1.47:8080/`.

1. Connect the Mac and the phone to the **same Wi-Fi network**.
2. Start the app, then scan the QR code with the phone camera.
3. If the page does not load, allow **Java** to accept incoming connections when
   macOS shows a firewall prompt (System Settings → Network → Firewall).
4. If no LAN address is detected, the card falls back to `localhost` and shows a warning.

The server exposes the detection result at `/api/network-info`, and the QR PNG
itself at `/api/qr` (also used by the page).

---

## API

Base URL: `http://localhost:8080`

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/menu` | All menu items. Optional `?availableOnly=true`. |
| `GET` | `/api/menu/{id}` | One menu item. |
| `GET` | `/api/orders` | All orders, newest queue first. Optional `?status=PENDING`. |
| `GET` | `/api/orders/{id}` | One order. |
| `GET` | `/api/orders/stats` | Queue and status counts. |
| `POST` | `/api/orders` | Place an order. Returns `201 Created`. |
| `PATCH` | `/api/orders/{id}/status` | Update status. Body: `{"status":"PREPARING"}`. |
| `GET` | `/api/network-info` | LAN IP, menu URL, and QR URL. |
| `GET` | `/api/qr?size=360&url=...` | QR code PNG. `url` defaults to the detected menu URL. |

### Place an order

```bash
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Maria",
    "notes": "Extra rice please",
    "items": [
      { "menuItemId": 1, "quantity": 2 },
      { "menuItemId": 4, "quantity": 1 }
    ]
  }'
```

```json
{
  "id": 1,
  "queueNumber": 1,
  "customerName": "Maria",
  "notes": "Extra rice please",
  "items": [
    { "menuItemId": 1, "name": "Adobo", "unitPrice": 85.0, "quantity": 2, "lineTotal": 170.0 },
    { "menuItemId": 4, "name": "Iced Tea", "unitPrice": 35.0, "quantity": 1, "lineTotal": 35.0 }
  ],
  "totalAmount": 205.0,
  "status": "PENDING",
  "createdAt": "2026-10-29T07:22:05Z",
  "updatedAt": null
}
```

**Important:** prices and totals are always calculated on the server from the
database. The client sends only menu item IDs and quantities, so totals cannot
be tampered with. Item names and prices are snapshotted onto the order.

### Order statuses

`PENDING` → `PREPARING` → `READY` → `COMPLETED`, or `CANCELLED` at any point
before completion.

---

## Data & database

The app uses a **file-based H2 database** stored in `./data/canteendb`, seeded
on first start with five items: Adobo, Sisig, Hotdog, Iced Tea, and Halo-Halo.

- **Orders and menu edits survive restarts** (the `data/` folder is gitignored).
- Delete the `data/` folder to start over with a fresh, empty database.
- On a host with an ephemeral filesystem (such as Render's free tier), mount a
  persistent disk and set
  `SPRING_DATASOURCE_URL=jdbc:h2:file:/data/canteendb` so data survives deploys.

### H2 console login

| Field | Value |
| --- | --- |
| JDBC URL | `jdbc:h2:file:./data/canteendb` |
| User Name | `sa` |
| Password | *(leave blank)* |

### Queue numbers

Each new order gets the next number based on the highest existing queue number.
The counter is synchronized and the queue number has a unique database index,
so simultaneous orders cannot receive the same number.

---

## Project structure

```
canteen-ordering/
├── pom.xml
├── mvnw / mvnw.cmd
├── .mvn/wrapper/maven-wrapper.properties
├── README.md
└── src/main/
    ├── java/com/canteen/ordering/
    │   ├── CanteenOrderingApplication.java
    │   ├── config/        # CORS + menu seeding
    │   ├── controller/    # Menu, orders, network info + QR
    │   ├── dto/           # Request/response records + validation
    │   ├── exception/     # 404 + validation error handling
    │   ├── model/         # MenuItem, Order, OrderItem, OrderStatus
    │   ├── repository/    # Spring Data JPA repositories
    │   └── service/       # Queue numbers, totals, status transitions
    └── resources/
        ├── application.properties
        └── static/
            ├── index.html      # Student menu
            ├── style.css
            ├── app.js
            ├── kitchen.html    # Kitchen POS
            ├── kitchen.css
            ├── kitchen.js
            ├── favicon.svg
            └── images/         # adobo.jpg, sisig.jpg, hotdog.jpg, icedtea.jpg, halohalo.jpg
```

---

## Configuration

`src/main/resources/application.properties`:

```properties
server.port=${PORT:8080}
spring.datasource.url=jdbc:h2:file:./data/canteendb
spring.jpa.hibernate.ddl-auto=update
spring.h2.console.enabled=${H2_CONSOLE_ENABLED:true}
spring.h2.console.path=/h2-console
```

Other useful settings:

- **Change port:** set the `PORT` environment variable (falls back to 8080). The
  frontend and QR code read it automatically.
- **CORS:** all origins are allowed in `config/CorsConfig.java` for local testing.
- **Seed menu:** edit `config/DataSeeder.java`.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Port 8080 was already in use` | Stop the other process, or change `server.port` and restart. |
| Menu says "We couldn't load the menu" | Make sure the app is running on port 8080. If you opened the files directly (not via Spring Boot), the frontend expects `http://localhost:8080`. |
| QR code does not load | Start the app through Spring Boot so `/api/qr` is available. |
| Phone cannot open the QR link | Phone and Mac must be on the same Wi-Fi; allow Java through the macOS firewall. |
| Food images are blank | Check that `/images/adobo.jpg`, `/images/sisig.jpg`, `/images/hotdog.jpg`, `/images/icedtea.jpg`, and `/images/halohalo.jpg` exist. A category emoji is shown as a fallback. |
| Orders disappeared | On Render, make sure the H2 file lives on a mounted persistent disk (see [Data & database](#data--database)). |

---

## Notes for development

- The Maven wrapper pins Maven 3.9.16; Spring Boot 4.1.2; ZXing 3.5.4 for QR codes.
- Frontend files are served from `src/main/resources/static/`; no npm, bundler, or transpiler.
- The API base uses the page's own origin whenever it is served over HTTP/HTTPS
  (localhost, LAN IP, or Render's HTTPS domain), otherwise it falls back to
  `http://localhost:8080` (useful when opening the HTML files directly).
- Static asset caching is disabled during development (`spring.web.resources.cache.period=0`).
