# 🔧 إصلاح مشكلة Checkout API

## ❌ المشكلة:

عند محاولة إنشاء طلب جديد، كان يظهر الخطأ التالي:

```json
{
  "success": false,
  "error": {
    "code": 500,
    "message": "Failed query: insert into orders..."
  }
}
```

### السبب:
الحقل `branchId` في جدول `orders` هو **NOT NULL** (مطلوب)، لكن الكود لم يكن يتحقق من وجوده قبل محاولة الإدراج في قاعدة البيانات.

---

## ✅ الحل:

تم إضافة validation للتحقق من وجود `branchId` قبل معالجة الطلب:

```typescript
// التحقق من branchId
if (!branchId) {
    throw new BadRequest("Branch ID is required");
}
```

---

## 📋 الحقول المطلوبة في Checkout API:

### Required Fields:
```json
{
  "branchId": "uuid",           // ✅ مطلوب (تم إضافة validation)
  "orderSource": "string",      // ✅ مطلوب (online_order, food_aggregator, mykeeto)
  "paymentMethod": "string",    // ✅ مطلوب (cash_on_delivery, visa, wallet)
  "orderType": "string"         // اختياري (delivery, takeaway, dine_in)
}
```

### Optional Fields:
```json
{
  "idempotencyKey": "string",   // لمنع تكرار الطلب
  "userZoneId": "uuid",         // منطقة المستخدم
  "addressId": "uuid"           // مطلوب فقط إذا orderType = "delivery"
}
```

---

## 🎯 مثال على Request صحيح:

```bash
POST /api/user/order/checkout
Authorization: Bearer {token}
Content-Type: application/json

{
  "branchId": "2601ba82-df3d-43ed-b981-0cd9eb24de0e",
  "orderSource": "mykeeto",
  "paymentMethod": "cash_on_delivery",
  "orderType": "delivery",
  "addressId": "2601ba82-df3d-43ed-b981-0cd9eb24de0e",
  "idempotencyKey": "818db3df-559b-46f4-8a81-a517d381d9af"
}
```

---

## 🔍 Validation Errors:

### 1. Missing branchId:
```json
{
  "success": false,
  "message": "Branch ID is required"
}
```

### 2. Invalid orderSource:
```json
{
  "success": false,
  "message": "Invalid order source"
}
```
**Valid values:** `online_order`, `food_aggregator`, `mykeeto`

### 3. Invalid paymentMethod:
```json
{
  "success": false,
  "message": "Invalid payment method"
}
```
**Valid values:** `cash_on_delivery`, `visa`, `wallet`

### 4. Missing addressId (for delivery):
```json
{
  "success": false,
  "message": "Delivery address is required"
}
```

---

## 📊 كيفية الحصول على branchId:

استخدم API الـ prerequisites للحصول على قائمة الفروع المتاحة:

```bash
GET /api/user/order/select?restaurantId={restaurantId}
Authorization: Bearer {token}
```

### Response:
```json
{
  "success": true,
  "data": {
    "addresses": [...],
    "branches": [
      {
        "id": "2601ba82-df3d-43ed-b981-0cd9eb24de0e",
        "name": "Main Branch",
        "address": "123 Street",
        "zoneId": "zone-123"
      }
    ],
    "paymentMethods": [...]
  }
}
```

---

## 🚀 الخطوات الصحيحة لإنشاء طلب:

### 1. جلب متطلبات الطلب:
```javascript
const prerequisites = await fetch(
  `/api/user/order/select?restaurantId=${restaurantId}`,
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

const { branches, addresses, paymentMethods } = await prerequisites.json();
```

### 2. اختيار الفرع والعنوان:
```javascript
const selectedBranch = branches[0]; // أو دع المستخدم يختار
const selectedAddress = addresses[0]; // أو دع المستخدم يختار
```

### 3. إنشاء الطلب:
```javascript
const order = await fetch('/api/user/order/checkout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    branchId: selectedBranch.id,
    addressId: selectedAddress.id,
    orderSource: 'mykeeto',
    paymentMethod: 'cash_on_delivery',
    orderType: 'delivery',
    idempotencyKey: generateUUID() // لمنع التكرار
  })
});

const result = await order.json();
console.log(result);
```

---

## ✅ Success Response:

```json
{
  "success": true,
  "message": "Order created successfully",
  "data": {
    "orderDetails": {
      "orderId": "f56899dc-c36c-4168-8467-1920a986a3de",
      "orderNumber": "ORD-1779361028952",
      "subtotal": 510,
      "deliveryFee": 20,
      "serviceFee": 5,
      "totalAmount": 535
    },
    "customerDetails": {
      "id": "1fff9b7d-3c2c-44d0-aa29-e86010f40b75",
      "name": "John Doe",
      "phone": "+201234567890",
      "email": "john@example.com"
    }
  }
}
```

---

## 📝 ملاحظات مهمة:

1. ✅ **branchId مطلوب دائماً** - تأكد من إرساله في كل طلب
2. ✅ **addressId مطلوب فقط للتوصيل** - إذا كان orderType = "delivery"
3. ✅ **استخدم idempotencyKey** - لمنع تكرار الطلب في حالة إعادة المحاولة
4. ✅ **تحقق من رصيد المحفظة** - قبل اختيار paymentMethod = "wallet"
5. ✅ **تحقق من منطقة التوصيل** - المطعم يجب أن يوصل لمنطقتك

---

## 🔧 الملفات المُعدلة:

- ✅ `src/controllers/user/order.ts` - تم إضافة validation للـ branchId

---

تم إصلاح المشكلة بنجاح! 🎉
