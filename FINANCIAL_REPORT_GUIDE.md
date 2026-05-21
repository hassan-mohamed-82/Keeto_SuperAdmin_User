# 📊 دليل التقرير المالي التفصيلي للمطاعم

## نظرة عامة
هذا التقرير يوضح الحسابات المالية الكاملة بين المنصة والمطاعم، مع تفصيل من يدين لمن وبكم.

---

## 🔍 فهم البيانات المالية

### 1️⃣ **إحصائيات الطلبات** (`orders`)
```json
{
  "total": 150,           // إجمالي الطلبات المسلمة
  "online": 120,          // طلبات من المنصة مباشرة
  "aggregator": 30        // طلبات من تطبيقات أخرى
}
```

### 2️⃣ **الماليات التفصيلية** (`financials`)

#### **المبيعات:**
- `totalSales`: إجمالي قيمة الطلبات (شامل كل شيء)
- `subtotal`: قيمة الطعام فقط (بدون رسوم)
- `cashOrders`: الطلبات المدفوعة نقداً
- `digitalOrders`: الطلبات المدفوعة إلكترونياً (فيزا/محفظة)

#### **الرسوم:**
- `deliveryFee`: رسوم التوصيل (تذهب للمطعم)
- `serviceFee`: رسوم الخدمة (تذهب للمنصة)

#### **العمولة:**
- `commissionRate`: نسبة العمولة (مثال: 15%)
- `platformCommission`: العمولة الفعلية المحسوبة
- `calculatedCommission`: العمولة المحسوبة من الخطة

#### **الصافي:**
- `restaurantNetSales`: صافي مبيعات المطعم بعد خصم العمولة والرسوم

---

### 3️⃣ **المستحقات والديون** (`cashDue`) - الأهم! 💰

#### **السيناريو:**
المطعم باع بـ 10,000 جنيه:
- 6,000 جنيه نقداً (Cash)
- 4,000 جنيه رقمياً (Digital)

العمولة: 15%
رسوم الخدمة: 500 جنيه

#### **الحسابات:**

**أ) الطلبات النقدية (6,000 جنيه):**
- المطعم حصل النقدية = 6,000 جنيه ✅
- المطعم يدين للمنصة:
  - عمولة: 6,000 × 15% = 900 جنيه
  - رسوم خدمة: 500 × (6,000/10,000) = 300 جنيه
  - **المجموع: 1,200 جنيه** ❌ (المطعم يدين)

**ب) الطلبات الرقمية (4,000 جنيه):**
- المنصة حصلت المبلغ = 4,000 جنيه ✅
- المنصة تدين للمطعم:
  - صافي المبيعات: 4,000 - (4,000 × 15%) - 200 = 3,200 جنيه
  - **المجموع: 3,200 جنيه** ✅ (المنصة تدين)

**ج) الرصيد النهائي:**
```
netBalance = المنصة تدين - المطعم يدين
netBalance = 3,200 - 1,200 = +2,000 جنيه
```

**النتيجة:** المنصة تدين للمطعم 2,000 جنيه ✅

---

### 📋 **حقول `cashDue`:**

```json
{
  "cashCollectedByRestaurant": "6000.00",      // النقدية التي حصلها المطعم
  "restaurantOwesToPlatform": "1200.00",       // المطعم يدين للمنصة
  "platformOwesToRestaurant": "3200.00",       // المنصة تدين للمطعم
  "netBalance": "2000.00",                     // الرصيد النهائي
  "balanceStatus": "المنصة تدين للمطعم 2000.00 جنيه"
}
```

#### **قراءة `netBalance`:**
- **موجب (+)**: المنصة تدين للمطعم → يجب تحويل المبلغ للمطعم
- **سالب (-)**: المطعم يدين للمنصة → يجب تحصيل المبلغ من المطعم
- **صفر (0)**: لا توجد مستحقات

---

## 📊 الملخص العام (`summary`)

```json
{
  "totalRestaurants": 25,                          // عدد المطاعم
  "grandTotalSales": "250000.00",                  // إجمالي المبيعات
  "grandTotalCash": "150000.00",                   // إجمالي النقدي
  "grandTotalDigital": "100000.00",                // إجمالي الرقمي
  "totalPlatformCommission": "37500.00",           // إجمالي العمولات
  "totalPlatformOwesToRestaurants": "85000.00",    // المنصة تدين للمطاعم
  "totalRestaurantsOweToPlatform": "45000.00",     // المطاعم تدين للمنصة
  "netPlatformBalance": "-40000.00"                // الرصيد الصافي للمنصة
}
```

### **قراءة `netPlatformBalance`:**
- **سالب (-)**: المنصة تدين للمطاعم (يجب دفع 40,000 جنيه)
- **موجب (+)**: المطاعم تدين للمنصة (يجب تحصيل المبلغ)

---

## 🎯 حالات الاستخدام

### 1. **معرفة المستحقات لمطعم معين:**
```javascript
const restaurant = data.restaurants.find(r => r.restaurantId === "xxx");
console.log(restaurant.cashDue.balanceStatus);
// "المنصة تدين للمطعم 2000.00 جنيه"
```

### 2. **حساب إجمالي ما يجب دفعه للمطاعم:**
```javascript
const totalToPay = data.summary.totalPlatformOwesToRestaurants;
// "85000.00"
```

### 3. **حساب إجمالي ما يجب تحصيله من المطاعم:**
```javascript
const totalToCollect = data.summary.totalRestaurantsOweToPlatform;
// "45000.00"
```

---

## ⚠️ ملاحظات مهمة

1. **التقرير يشمل فقط الطلبات المسلمة** (`status = "delivered"`)
2. **العمولة تُحسب على `subtotal` وليس `totalAmount`**
3. **رسوم التوصيل تذهب للمطعم**
4. **رسوم الخدمة تذهب للمنصة**
5. **الحسابات تأخذ في الاعتبار نسبة كل طريقة دفع**

---

## 🔧 API Endpoint

```
GET /api/admin/reports/detailed-restaurant-report
```

### Query Parameters:
- `startDate` (optional): تاريخ البداية (YYYY-MM-DD)
- `endDate` (optional): تاريخ النهاية (YYYY-MM-DD)

### Example:
```
GET /api/admin/reports/detailed-restaurant-report?startDate=2024-01-01&endDate=2024-01-31
```

---

## 📝 مثال على Response كامل

```json
{
  "success": true,
  "message": "Detailed restaurant report generated successfully",
  "data": {
    "summary": {
      "totalRestaurants": 2,
      "grandTotalSales": "15000.00",
      "grandTotalCash": "9000.00",
      "grandTotalDigital": "6000.00",
      "totalPlatformCommission": "2250.00",
      "totalPlatformOwesToRestaurants": "5100.00",
      "totalRestaurantsOweToPlatform": "1350.00",
      "netPlatformBalance": "-3750.00"
    },
    "restaurants": [
      {
        "restaurantId": "abc-123",
        "restaurantName": "مطعم الأصالة",
        "orders": {
          "total": 50,
          "online": 45,
          "aggregator": 5
        },
        "financials": {
          "totalSales": "10000.00",
          "subtotal": "9000.00",
          "cashOrders": "6000.00",
          "digitalOrders": "4000.00",
          "deliveryFee": "500.00",
          "serviceFee": "500.00",
          "commissionRate": "15%",
          "platformCommission": "1350.00",
          "calculatedCommission": "1350.00",
          "restaurantNetSales": "8150.00"
        },
        "cashDue": {
          "cashCollectedByRestaurant": "6000.00",
          "restaurantOwesToPlatform": "1200.00",
          "platformOwesToRestaurant": "3200.00",
          "netBalance": "2000.00",
          "balanceStatus": "المنصة تدين للمطعم 2000.00 جنيه"
        },
        "businessPlan": [
          {
            "platformType": "online_order",
            "commissionRate": "15.00",
            "serviceFee": "5.00"
          }
        ]
      }
    ]
  }
}
```

---

## 💡 نصائح

1. استخدم `balanceStatus` لعرض الحالة بشكل واضح للمستخدم
2. راجع `netPlatformBalance` لمعرفة الوضع المالي العام
3. تحقق من `calculatedCommission` vs `platformCommission` للتأكد من صحة الحسابات
4. استخدم الفلترة بالتاريخ لإنشاء تقارير شهرية/أسبوعية

---

تم إنشاء هذا الدليل بواسطة Kiro AI 🤖
