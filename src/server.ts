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

dotenv.config();

const app = express();
connectDB(); 

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// إعدادات CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));

// إعدادات الحماية Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// إعداد المسارات الثابتة (Static Files)
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.static(path.join(process.cwd(), "public")));

// اختبار عمل الـ API
app.get("/api", (req, res) => {
  res.json({ message: "API is working!" });
});

// الصفحة الرئيسية
app.get("/", (req, res) => {
  // إذا لم يكن الملف موجوداً، يفضل إرسال نص بسيط أو التأكد من وجود index.html
  res.sendFile(path.join(process.cwd(), "public", "index.html"), (err) => {
    if (err) {
      res.status(200).send("<h1>Welcome to Keeto API</h1>");
    }
  });
});

// مسارات الـ API
app.use("/api", ApiRoute);

// معالج مسارات 404 - تم تعديله لتجنب خطأ ENOENT
app.use((req, res, next) => {
  // إذا كان الطلب صفحة (Browser) وليس API
  if (!req.path.startsWith("/api") && req.method === "GET") {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Keeto - 404</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f4f6f8; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .container { text-align: center; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
          h1 { color: #ff6b00; font-size: 50px; margin: 0; }
          p { color: #666; font-size: 18px; }
          a { color: #ff6b00; text-decoration: none; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>404</h1>
          <p>عذراً، الصفحة غير موجودة</p>
          <a href="/">العودة للرئيسية</a>
        </div>
      </body>
      </html>
    `);
  }

  // إذا كان الطلب لـ API غير موجود
  next(new NotFound("Route not found"));
});

// معالج الأخطاء العام
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});