import express from "express";
import path from "path";
import ApiRoute from "./routes";
import { errorHandler } from "./middlewares/errorHandler";
import { NotFound } from "./Errors";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import http from "http";
import { Server } from "socket.io";
import { sanitizeRequest } from "./middlewares/sanitize";


dotenv.config();

const app = express();

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});


app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// const apiLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
//   message: {
//     success: false,
//     message: "Too many requests from this IP, please try again after an 15 minutes"
//   },
//   standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
//   legacyHeaders: false, // Disable the `X-RateLimit-*` headers
// });

// app.use(apiLimiter);

app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Data Sanitization against XSS
app.use(sanitizeRequest);

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.static(path.join(process.cwd(), "public")));
app.use("/public", express.static(path.join(process.cwd(), "public")));

app.get("/api/test", (req, res, next) => {
  res.json({ message: "API is working! notify token" });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.use("/api", ApiRoute);

app.use((req, res, next) => {
  if (!req.path.startsWith("/api") && req.method === "GET") {
    return res.status(404).sendFile(path.join(process.cwd(), "public", "404.html"));
  }

  throw new NotFound("Route not found");
});

app.use(errorHandler);

httpServer.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});