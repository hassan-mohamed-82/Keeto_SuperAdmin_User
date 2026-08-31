"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const routes_1 = __importDefault(require("./routes"));
const errorHandler_1 = require("./middlewares/errorHandler");
const Errors_1 = require("./Errors");
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const connection_1 = require("./models/connection");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.set("trust proxy", true);
(0, connection_1.connectDB)();
const httpServer = http_1.default.createServer(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
// إعدادات CORS
app.use((0, cors_1.default)({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
}));
// إعدادات الحماية Helmet
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: false,
}));
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json({ limit: "20mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "20mb" }));
// إعداد المسارات الثابتة (Static Files مع التخزين المؤقت)
app.use("/uploads", express_1.default.static(path_1.default.join(__dirname, "../uploads"), {
    maxAge: "30d",
    immutable: true
}));
app.use(express_1.default.static(path_1.default.join(process.cwd(), "public")));
// اختبار عمل الـ API
app.get("/api", (req, res) => {
    res.json({ message: "API is working!" });
});
// الصفحة الرئيسية
app.get("/", (req, res) => {
    // إذا لم يكن الملف موجوداً، يفضل إرسال نص بسيط أو التأكد من وجود index.html
    res.sendFile(path_1.default.join(process.cwd(), "public", "index.html"), (err) => {
        if (err) {
            res.status(200).send("<h1>Welcome to Keeto API</h1>");
        }
    });
});
// مسارات الـ API
app.use("/api", routes_1.default);
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
    next(new Errors_1.NotFound("Route not found"));
});
// معالج الأخطاء العام
app.use(errorHandler_1.errorHandler);
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
