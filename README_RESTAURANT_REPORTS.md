# 📊 دليل شامل لتقارير المطاعم

## 🎯 نظرة عامة

تم إنشاء نظام تقارير مالية متكامل للمطاعم يوفر:
1. تقرير مالي عام لكل المطاعم
2. تقرير تفصيلي لكل مطعم على حدة
3. **تقرير مطعم واحد مع تقسيم حسب نوع الطلب** ⭐ (جديد)

---

## 📁 الملفات المُنشأة

### 1. Backend Files:
- ✅ `src/controllers/admin/Report.ts` - Controllers للتقارير
- ✅ `src/routes/admin/Report.ts` - Routes للتقارير
- ✅ `src/models/schema/admin/restaurants.ts` - تم تحديث Schema

### 2. Documentation Files:
- 📄 `FINANCIAL_REPORT_GUIDE.md` - دليل شامل للتقرير المالي
- 📄 `FINANCIAL_REPORT_EXAMPLES.md` - أمثلة عملية
- 📄 `SINGLE_RESTAURANT_REPORT_API.md` - دليل API المطعم الواحد
- 📄 `RESTAURANT_REPORT_SUMMARY.md` - ملخص سريع
- 📄 `RESTAURANT_REPORT_EXAMPLE.js` - أمثلة كود JavaScript
- 📄 `README_RESTAURANT_REPORTS.md` - هذا الملف

---

## 🔗 API Endpoints

### 1. التقرير المالي العام
```
GET /api/admin/report/
```
**Query Parameters:**
- `restaurantId` (optional)
- `startDate` (optional)
- `endDate` (optional)
- `status` (optional)
- `paymentMethod` (optional)

### 2. التقرير التفصيلي لكل المطاعم
```
GET /api/admin/report/detailed
```
**Query Parameters:**
- `startDate` (optional)
- `endDate` (optional)

### 3. تقرير مطعم واحد ⭐ (جديد)
```
GET /api/admin/report/restaurant/:restaurantId
```
**Path Parameters:**
- `restaurantId` (required)

**Query Parameters:**
- `startDate` (optional)
- `endDate` (optional)

---

## 🎨 ما يميز تقرير المطعم الواحد

### التقسيم حسب نوع الطلب:

#### 1️⃣ **Online Order** (طلبات أونلاين)
الطلبات من تطبيق/موقع المنصة مباشرة

#### 2️⃣ **Food Aggregator** (طلبات من تطبيقات أخرى)
الطلبات من تطبيقات توصيل أخرى (Talabat, Uber Eats, etc.)

#### 3️⃣ **Mykeeto** (طلبات Mykeeto)
الطلبات الخاصة بنظام Mykeeto

### لكل نوع طلب:
- ✅ عدد الطلبات
- ✅ إجمالي الإيرادات
- ✅ تقسيم حسب طريقة الدفع (نقدي، فيزا، محفظة)
- ✅ الرسوم والعمولات
- ✅ **المستحقات: لينا كام وعلينا كام** 💰

---

## 💰 فهم المستحقات (Cash Due)

### في كل تقرير ستجد:

```json
{
  "cashDue": {
    "cashCollected": "16000.00",              // النقدية المحصلة
    "restaurantOwesToPlatform": "3200.00",    // المطعم يدين للمنصة
    "platformOwesToRestaurant": "8000.00",    // المنصة تدين للمطعم
    "netBalance": "4800.00",                  // الرصيد النهائي
    "balanceStatus": "المنصة تدين للمطعم 4800.00 جنيه"
  }
}
```

### قراءة `netBalance`:
| القيمة | المعنى | الإجراء |
|--------|---------|---------|
| **موجب (+)** | المنصة تدين للمطعم | تحويل المبلغ للمطعم ✅ |
| **سالب (-)** | المطعم يدين للمنصة | تحصيل المبلغ من المطعم ❌ |
| **صفر (0)** | لا توجد مستحقات | لا شيء ⚪ |

---

## 🚀 البدء السريع

### 1. استدعاء الـ API:

```javascript
// JavaScript/TypeScript
async function getRestaurantReport(restaurantId, startDate, endDate) {
  const response = await fetch(
    `/api/admin/report/restaurant/${restaurantId}?startDate=${startDate}&endDate=${endDate}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const data = await response.json();
  return data.data;
}

// استخدام
const report = await getRestaurantReport('abc-123', '2024-01-01', '2024-01-31');
console.log(report);
```

### 2. عرض البيانات:

```javascript
// عرض الإجماليات
console.log('إجمالي الطلبات:', report.totals.totalOrders);
console.log('إجمالي الإيرادات:', report.totals.totalRevenue);
console.log(report.totals.cashDue.balanceStatus);

// عرض التقرير حسب نوع الطلب
report.reportBySource.forEach(source => {
  console.log(`\n${source.orderSourceName}:`);
  console.log(`  الطلبات: ${source.statistics.totalOrders}`);
  console.log(`  الإيرادات: ${source.statistics.totalRevenue}`);
  console.log(`  ${source.cashDue.balanceStatus}`);
});
```

---

## 📊 مثال على Response

```json
{
  "success": true,
  "message": "Single restaurant report generated successfully",
  "data": {
    "restaurant": {
      "id": "abc-123",
      "name": "مطعم الأصالة"
    },
    
    "reportBySource": [
      {
        "orderSource": "online_order",
        "orderSourceName": "طلبات أونلاين",
        "statistics": {
          "totalOrders": 45,
          "totalRevenue": "15000.00"
        },
        "paymentBreakdown": {
          "cash": "9000.00",
          "visa": "4000.00",
          "wallet": "2000.00"
        },
        "cashDue": {
          "netBalance": "3000.00",
          "balanceStatus": "المنصة تدين للمطعم 3000.00 جنيه"
        }
      }
      // ... باقي أنواع الطلبات
    ],
    
    "totals": {
      "totalOrders": 75,
      "totalRevenue": "26000.00",
      "paymentBreakdown": {
        "cash": "16000.00",
        "visa": "6500.00",
        "wallet": "3500.00"
      },
      "cashDue": {
        "netBalance": "4800.00",
        "balanceStatus": "المنصة تدين للمطعم 4800.00 جنيه"
      }
    }
  }
}
```

---

## 🎨 تصميم الـ UI المقترح

### صفحة المطعم يجب أن تحتوي على:

```
┌─────────────────────────────────────────────────┐
│  📊 تقرير مطعم: مطعم الأصالة                    │
│  📅 من 2024-01-01 إلى 2024-01-31               │
└─────────────────────────────────────────────────┘

┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 📦 الطلبات│ 💰 الإيرادات│ 💵 نقدي │ 💳 فيزا │ 👛 محفظة │
│    75    │  26,000  │  16,000  │  6,500   │  3,500   │
└──────────┴──────────┴──────────┴──────────┴──────────┘

┌─────────────────────────────────────────────────┐
│  💰 الرصيد النهائي                              │
│  ✅ المنصة تدين للمطعم 4,800 جنيه              │
│                                                 │
│  المطعم يدين للمنصة: 3,200 جنيه                │
│  المنصة تدين للمطعم: 8,000 جنيه                │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  📊 التقرير حسب نوع الطلب                       │
│                                                 │
│  [طلبات أونلاين] [تطبيقات أخرى] [Mykeeto]     │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ طلبات أونلاين                             │ │
│  │ الطلبات: 45 | الإيرادات: 15,000 جنيه     │ │
│  │ نقدي: 9,000 | فيزا: 4,000 | محفظة: 2,000│ │
│  │ ✅ المنصة تدين للمطعم 3,000 جنيه         │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## 📚 الملفات المرجعية

### للمطورين:
1. **`SINGLE_RESTAURANT_REPORT_API.md`** - دليل API كامل مع أمثلة
2. **`RESTAURANT_REPORT_EXAMPLE.js`** - أمثلة كود جاهزة للاستخدام
3. **`FINANCIAL_REPORT_GUIDE.md`** - شرح تفصيلي للحسابات المالية

### للمديرين:
1. **`RESTAURANT_REPORT_SUMMARY.md`** - ملخص سريع وسهل
2. **`FINANCIAL_REPORT_EXAMPLES.md`** - أمثلة عملية وحالات استخدام

---

## 🔐 الصلاحيات المطلوبة

```javascript
// في الـ middleware
hasPermission("reports", "View")

// يجب أن يكون المستخدم:
// 1. مسجل دخول (Authenticated)
// 2. لديه صلاحية "reports" مع "View"
```

---

## ⚠️ ملاحظات مهمة

1. ✅ التقرير يشمل فقط الطلبات المسلمة (`status = "delivered"`)
2. ✅ العمولة تُحسب على `subtotal` وليس `totalAmount`
3. ✅ رسوم التوصيل تذهب للمطعم
4. ✅ رسوم الخدمة تذهب للمنصة
5. ✅ الحسابات تأخذ في الاعتبار نسبة كل طريقة دفع

---

## 🐛 معالجة الأخطاء

### 400 Bad Request
```json
{
  "success": false,
  "message": "Restaurant ID is required"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Restaurant not found"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Unauthenticated"
}
```

---

## 🚀 الخطوات التالية

### Backend: ✅ مكتمل
- [x] إنشاء Controller
- [x] إنشاء Route
- [x] تحديث Schema
- [x] Testing

### Frontend: ⏳ قيد التطوير
- [ ] إنشاء صفحة المطعم
- [ ] إضافة Charts وGraphs
- [ ] إضافة Filters (التاريخ)
- [ ] إضافة Export PDF/Excel
- [ ] إضافة Notifications

### Documentation: ✅ مكتمل
- [x] API Documentation
- [x] Code Examples
- [x] User Guide
- [x] Summary

---

## 💡 نصائح للتطوير

### 1. استخدم Charts:
```javascript
// مثال باستخدام Chart.js
const chartData = {
  labels: report.reportBySource.map(s => s.orderSourceName),
  datasets: [{
    label: 'الإيرادات',
    data: report.reportBySource.map(s => parseFloat(s.statistics.totalRevenue))
  }]
};
```

### 2. أضف Filters:
```javascript
// Date Range Picker
<DateRangePicker
  startDate={startDate}
  endDate={endDate}
  onChange={(start, end) => {
    fetchReport(restaurantId, start, end);
  }}
/>
```

### 3. أضف Export:
```javascript
// Export to PDF
function exportToPDF(report) {
  // استخدم مكتبة مثل jsPDF
  const doc = new jsPDF();
  doc.text(`تقرير ${report.restaurant.name}`, 10, 10);
  // ... إضافة البيانات
  doc.save('restaurant-report.pdf');
}
```

---

## 📞 الدعم

إذا كان لديك أي استفسارات أو مشاكل:
1. راجع الملفات المرجعية أعلاه
2. تحقق من الأمثلة في `RESTAURANT_REPORT_EXAMPLE.js`
3. راجع دليل الـ API في `SINGLE_RESTAURANT_REPORT_API.md`

---

## 📝 Changelog

### v1.0.0 (2024-01-XX)
- ✅ إنشاء API تقرير المطعم الواحد
- ✅ تقسيم البيانات حسب نوع الطلب (online_order, food_aggregator, mykeeto)
- ✅ حساب المستحقات لكل نوع طلب
- ✅ إنشاء Documentation كاملة
- ✅ إنشاء أمثلة كود جاهزة

---

تم إنشاء هذا الدليل بواسطة Kiro AI 🤖

**Happy Coding! 🚀**
