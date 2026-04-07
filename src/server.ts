import express from "express";
import path from "path";
import ApiRoute from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import { NotFound } from "./Errors";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import http from "http";
import { Server } from "socket.io";
import { connectDB } from './models/connection';

// استيراد Swagger
import swaggerUi from "swagger-ui-express";
import fs from "fs";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);

// إعداد Swagger: قراءة الملف المولد تلقائياً
// نستخدم try-catch لأن الملف قد لا يكون موجوداً في أول تشغيل قبل تنفيذ سكريبت الـ autogen
let swaggerDocument;
try {
    const swaggerPath = path.join(process.cwd(), "swagger-output.json");
    if (fs.existsSync(swaggerPath)) {
        swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, "utf8"));
    }
} catch (error) {
    console.log("⚠️ Swagger output file not found yet.");
}

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middlewares
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Static Files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.static(path.join(process.cwd(), "public")));
app.use("/public", express.static(path.join(process.cwd(), "public")));

// Swagger Route
if (swaggerDocument) {
    app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

// Routes
app.get("/api/test", (req, res) => {
  res.json({ message: "API is working! notify token" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.use("/api", ApiRoute);

// Error Handling
app.use((req, res, next) => {
  if (!req.path.startsWith("/api") && req.method === "GET") {
    return res.status(404).sendFile(path.join(process.cwd(), "public", "404.html"));
  }
  throw new NotFound("Route not found");
});

app.use(errorHandler);

// تشغيل السيرفر والاتصال بقاعدة البيانات
httpServer.listen(3000, async () => {
  await connectDB(); // فحص الاتصال عند التشغيل
  console.log("🚀 Server is running on http://localhost:3000");
  console.log("📖 Swagger docs available at http://localhost:3000/docs");
});