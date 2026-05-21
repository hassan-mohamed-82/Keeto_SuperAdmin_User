# 📊 أمثلة عملية على التقرير المالي

## مثال 1: مطعم يدين للمنصة

### السيناريو:
- المطعم باع بـ 5,000 جنيه
- كل المبيعات نقدية (Cash)
- العمولة: 20%
- رسوم الخدمة: 200 جنيه

### الحسابات:
```javascript
// المطعم حصل النقدية
cashCollected = 5,000 جنيه

// المطعم يدين للمنصة
restaurantOwesToPlatform = (5,000 × 20%) + 200 = 1,200 جنيه

// المنصة تدين للمطعم
platformOwesToRestaurant = 0 جنيه (لا توجد مبيعات رقمية)

// الرصيد النهائي
netBalance = 0 - 1,200 = -1,200 جنيه
```

### النتيجة:
```json
{
  "cashDue": {
    "cashCollectedByRestaurant": "5000.00",
    "restaurantOwesToPlatform": "1200.00",
    "platformOwesToRestaurant": "0.00",
    "netBalance": "-1200.00",
    "balanceStatus": "المطعم يدين للمنصة 1200.00 جنيه"
  }
}
```

**الإجراء المطلوب:** تحصيل 1,200 جنيه من المطعم ❌

---

## مثال 2: المنصة تدين للمطعم

### السيناريو:
- المطعم باع بـ 8,000 جنيه
- كل المبيعات رقمية (Digital)
- العمولة: 10%
- رسوم الخدمة: 300 جنيه

### الحسابات:
```javascript
// المطعم حصل النقدية
cashCollected = 0 جنيه

// المطعم يدين للمنصة
restaurantOwesToPlatform = 0 جنيه (لا توجد مبيعات نقدية)

// المنصة تدين للمطعم
platformOwesToRestaurant = 8,000 - (8,000 × 10%) - 300 = 6,900 جنيه

// الرصيد النهائي
netBalance = 6,900 - 0 = +6,900 جنيه
```

### النتيجة:
```json
{
  "cashDue": {
    "cashCollectedByRestaurant": "0.00",
    "restaurantOwesToPlatform": "0.00",
    "platformOwesToRestaurant": "6900.00",
    "netBalance": "6900.00",
    "balanceStatus": "المنصة تدين للمطعم 6900.00 جنيه"
  }
}
```

**الإجراء المطلوب:** تحويل 6,900 جنيه للمطعم ✅

---

## مثال 3: مبيعات مختلطة (نقدي + رقمي)

### السيناريو:
- المطعم باع بـ 20,000 جنيه
- 12,000 جنيه نقداً
- 8,000 جنيه رقمياً
- العمولة: 15%
- رسوم الخدمة: 1,000 جنيه

### الحسابات:

#### أ) الطلبات النقدية:
```javascript
cashCollected = 12,000 جنيه
restaurantOwesToPlatform = (12,000 × 15%) + (1,000 × 12,000/20,000)
                         = 1,800 + 600
                         = 2,400 جنيه
```

#### ب) الطلبات الرقمية:
```javascript
platformOwesToRestaurant = 8,000 - (8,000 × 15%) - (1,000 × 8,000/20,000)
                         = 8,000 - 1,200 - 400
                         = 6,400 جنيه
```

#### ج) الرصيد النهائي:
```javascript
netBalance = 6,400 - 2,400 = +4,000 جنيه
```

### النتيجة:
```json
{
  "cashDue": {
    "cashCollectedByRestaurant": "12000.00",
    "restaurantOwesToPlatform": "2400.00",
    "platformOwesToRestaurant": "6400.00",
    "netBalance": "4000.00",
    "balanceStatus": "المنصة تدين للمطعم 4000.00 جنيه"
  }
}
```

**الإجراء المطلوب:** تحويل 4,000 جنيه للمطعم ✅

---

## مثال 4: رصيد متوازن (صفر)

### السيناريو:
- المطعم باع بـ 10,000 جنيه
- 6,000 جنيه نقداً
- 4,000 جنيه رقمياً
- العمولة: 20%
- رسوم الخدمة: 0 جنيه

### الحسابات:

#### أ) الطلبات النقدية:
```javascript
restaurantOwesToPlatform = 6,000 × 20% = 1,200 جنيه
```

#### ب) الطلبات الرقمية:
```javascript
platformOwesToRestaurant = 4,000 - (4,000 × 20%) = 3,200 جنيه
```

#### ج) الرصيد النهائي:
```javascript
netBalance = 3,200 - 1,200 = +2,000 جنيه
```

### النتيجة:
```json
{
  "cashDue": {
    "cashCollectedByRestaurant": "6000.00",
    "restaurantOwesToPlatform": "1200.00",
    "platformOwesToRestaurant": "3200.00",
    "netBalance": "2000.00",
    "balanceStatus": "المنصة تدين للمطعم 2000.00 جنيه"
  }
}
```

---

## 📊 جدول مقارنة سريع

| السيناريو | النقدي | الرقمي | العمولة | المطعم يدين | المنصة تدين | الرصيد النهائي |
|-----------|--------|--------|---------|-------------|-------------|----------------|
| مثال 1 | 5,000 | 0 | 20% | 1,200 | 0 | -1,200 ❌ |
| مثال 2 | 0 | 8,000 | 10% | 0 | 6,900 | +6,900 ✅ |
| مثال 3 | 12,000 | 8,000 | 15% | 2,400 | 6,400 | +4,000 ✅ |
| مثال 4 | 6,000 | 4,000 | 20% | 1,200 | 3,200 | +2,000 ✅ |

---

## 🎯 كيفية قراءة التقرير بسرعة

### 1. انظر إلى `balanceStatus`:
```javascript
if (balanceStatus.includes("المنصة تدين")) {
  // يجب تحويل المبلغ للمطعم
  action = "تحويل";
} else if (balanceStatus.includes("المطعم يدين")) {
  // يجب تحصيل المبلغ من المطعم
  action = "تحصيل";
} else {
  // لا توجد مستحقات
  action = "لا شيء";
}
```

### 2. تحقق من `netBalance`:
```javascript
if (netBalance > 0) {
  console.log(`يجب تحويل ${netBalance} جنيه للمطعم`);
} else if (netBalance < 0) {
  console.log(`يجب تحصيل ${Math.abs(netBalance)} جنيه من المطعم`);
} else {
  console.log("الحساب متوازن");
}
```

### 3. راجع الملخص العام:
```javascript
const summary = data.summary;
console.log(`إجمالي ما يجب دفعه: ${summary.totalPlatformOwesToRestaurants}`);
console.log(`إجمالي ما يجب تحصيله: ${summary.totalRestaurantsOweToPlatform}`);
console.log(`الرصيد الصافي: ${summary.netPlatformBalance}`);
```

---

## 🔍 استعلامات مفيدة

### 1. المطاعم التي تدين للمنصة:
```javascript
const restaurantsOwing = data.restaurants.filter(r => 
  parseFloat(r.cashDue.netBalance) < 0
);
```

### 2. المطاعم التي المنصة تدين لها:
```javascript
const restaurantsOwed = data.restaurants.filter(r => 
  parseFloat(r.cashDue.netBalance) > 0
);
```

### 3. إجمالي العمولات المحصلة:
```javascript
const totalCommissions = data.restaurants.reduce((sum, r) => 
  sum + parseFloat(r.financials.platformCommission), 0
);
```

### 4. المطاعم الأكثر مبيعاً:
```javascript
const topRestaurants = data.restaurants
  .sort((a, b) => parseFloat(b.financials.totalSales) - parseFloat(a.financials.totalSales))
  .slice(0, 10);
```

---

## ⚠️ حالات خاصة

### حالة 1: مطعم بدون خطة عمل
```json
{
  "commissionRate": "0.00%",
  "platformCommission": "0.00",
  "calculatedCommission": "0.00"
}
```
**الحل:** تعيين خطة عمل للمطعم

### حالة 2: فرق بين العمولة المحسوبة والمسجلة
```json
{
  "platformCommission": "1500.00",
  "calculatedCommission": "1350.00"
}
```
**الحل:** مراجعة الطلبات والتأكد من صحة الحسابات

### حالة 3: مطعم بدون طلبات
```json
{
  "orders": {
    "total": 0,
    "online": 0,
    "aggregator": 0
  }
}
```
**الحل:** لن يظهر في التقرير (فقط الطلبات المسلمة)

---

## 📱 مثال على استخدام API

### JavaScript/TypeScript:
```typescript
async function getRestaurantReport(startDate: string, endDate: string) {
  const response = await fetch(
    `/api/admin/reports/detailed-restaurant-report?startDate=${startDate}&endDate=${endDate}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const data = await response.json();
  
  // عرض الملخص
  console.log('إجمالي المبيعات:', data.data.summary.grandTotalSales);
  console.log('إجمالي العمولات:', data.data.summary.totalPlatformCommission);
  
  // عرض المطاعم
  data.data.restaurants.forEach(restaurant => {
    console.log(`\n${restaurant.restaurantName}:`);
    console.log(`  المبيعات: ${restaurant.financials.totalSales}`);
    console.log(`  ${restaurant.cashDue.balanceStatus}`);
  });
}

// استخدام
getRestaurantReport('2024-01-01', '2024-01-31');
```

### cURL:
```bash
curl -X GET "http://localhost:3000/api/admin/reports/detailed-restaurant-report?startDate=2024-01-01&endDate=2024-01-31" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

تم إنشاء هذا الدليل بواسطة Kiro AI 🤖
