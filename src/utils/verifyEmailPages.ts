export const getVerifyEmailPage = (type: "success" | "error") => {
  const isSuccess = type === "success";

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Keeto Verification</title>
  <style>
    body {
      margin: 0;
      font-family: Arial;
      background: #f4f6f8;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
    }

    .box {
      text-align: center;
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.1);
      width: 400px;
    }

    h1 {
      color: ${isSuccess ? "#ff6b00" : "red"};
      margin-bottom: 10px;
    }

    p {
      color: #666;
      margin-bottom: 0;
    }

    .icon {
      font-size: 40px;
      margin-bottom: 10px;
    }

  </style>
</head>
<body>
  <div class="box">

    <div class="icon">
      ${isSuccess ? "🎉" : "❌"}
    </div>

    <h1>
      ${isSuccess ? "Email Verified" : "Verification Failed"}
    </h1>

    <p>
      ${
        isSuccess
          ? "Your Keeto account is now active"
          : "Link is invalid or expired"
      }
    </p>

  </div>
</body>
</html>
  `;
};