# 📊 API تقرير مطعم واحد - Single Restaurant Report

## نظرة عامة
هذا الـ API يعرض تقرير مالي تفصيلي لمطعم واحد مع تقسيم البيانات حسب نوع الطلب (online_order, food_aggregator, mykeeto).

---

## 🔗 Endpoint

```
GET /api/admin/reports/restaurant/:restaurantId
```

### Parameters:
- **Path Parameter:**
  - `restaurantId` (required): معرف المطعم (UUID)

- **Query Parameters:**
  - `startDate` (optional): تاريخ البداية (YYYY-MM-DD)
  - `endDate` (optional): تاريخ النهاية (YYYY-MM-DD)

### Headers:
```
Authorization: Bearer {token}
```

---

## 📋 مثال على الاستخدام

### Request:
```bash
GET /api/admin/reports/restaurant/abc-123-def-456?startDate=2024-01-01&endDate=2024-01-31
```

### Response:
```json
{
  "success": true,
  "message": "Single restaurant report generated successfully",
  "data": {
    "restaurant": {
      "id": "abc-123-def-456",
      "name": "مطعم الأصالة",
      "nameAr": "مطعم الأصالة",
      "nameFr": "Restaurant Al Asala"
    },
    
    "reportBySource": [
      {
        "orderSource": "online_order",
        "orderSourceName": "طلبات أونلاين",
        
        "statistics": {
          "totalOrders": 45,
          "totalRevenue": "15000.00",
          "subtotal": "13500.00"
        },
        
        "paymentBreakdown": {
          "cash": "9000.00",
          "visa": "4000.00",
          "wallet": "2000.00"
        },
        
        "fees": {
          "deliveryFee": "750.00",
          "serviceFee": "750.00",
          "commission": "2025.00",
          "commissionRate": "15%"
        },
        
        "cashDue": {
          "cashCollected": "9000.00",
          "restaurantOwesToPlatform": "1800.00",
          "platformOwesToRestaurant": "4800.00",
          "netBalance": "3000.00",
          "balanceStatus": "المنصة تدين للمطعم 3000.00 جنيه"
        }
      },
      {
        "orderSource": "food_aggregator",
        "orderSourceName": "طلبات من تطبيقات أخرى",
        
        "statistics": {
          "totalOrders": 20,
          "totalRevenue": "8000.00",
          "subtotal": "7200.00"
        },
        
        "paymentBreakdown": {
          "cash": "5000.00",
          "visa": "2000.00",
          "wallet": "1000.00"
        },
        
        "fees": {
          "deliveryFee": "400.00",
          "serviceFee": "400.00",
          "commission": "1080.00",
          "commissionRate": "15%"
        },
        
        "cashDue": {
          "cashCollected": "5000.00",
          "restaurantOwesToPlatform": "1000.00",
          "platformOwesToRestaurant": "2400.00",
          "netBalance": "1400.00",
          "balanceStatus": "المنصة تدين للمطعم 1400.00 جنيه"
        }
      },
      {
        "orderSource": "mykeeto",
        "orderSourceName": "طلبات Mykeeto",
        
        "statistics": {
          "totalOrders": 10,
          "totalRevenue": "3000.00",
          "subtotal": "2700.00"
        },
        
        "paymentBreakdown": {
          "cash": "2000.00",
          "visa": "500.00",
          "wallet": "500.00"
        },
        
        "fees": {
          "deliveryFee": "150.00",
          "serviceFee": "150.00",
          "commission": "405.00",
          "commissionRate": "15%"
        },
        
        "cashDue": {
          "cashCollected": "2000.00",
          "restaurantOwesToPlatform": "400.00",
          "platformOwesToRestaurant": "800.00",
          "netBalance": "400.00",
          "balanceStatus": "المنصة تدين للمطعم 400.00 جنيه"
        }
      }
    ],
    
    "totals": {
      "totalOrders": 75,
      "totalRevenue": "26000.00",
      "totalSubtotal": "23400.00",
      
      "paymentBreakdown": {
        "cash": "16000.00",
        "visa": "6500.00",
        "wallet": "3500.00"
      },
      
      "fees": {
        "totalDeliveryFee": "1300.00",
        "totalServiceFee": "1300.00",
        "totalCommission": "3510.00",
        "commissionRate": "15%"
      },
      
      "cashDue": {
        "cashCollected": "16000.00",
        "restaurantOwesToPlatform": "3200.00",
        "platformOwesToRestaurant": "8000.00",
        "netBalance": "4800.00",
        "balanceStatus": "المنصة تدين للمطعم 4800.00 جنيه"
      }
    },
    
    "businessPlan": [
      {
        "platformType": "online_order",
        "commissionRate": "15.00",
        "serviceFee": "5.00"
      }
    ]
  }
}
```

---

## 📊 شرح البيانات

### 1. **معلومات المطعم** (`restaurant`)
معلومات أساسية عن المطعم (الاسم، المعرف، إلخ)

### 2. **التقرير حسب نوع الطلب** (`reportBySource`)
تقسيم البيانات حسب مصدر الطلب:

#### **أ) online_order** - طلبات أونلاين
الطلبات التي تأتي من تطبيق/موقع المنصة مباشرة

#### **ب) food_aggregator** - طلبات من تطبيقات أخرى
الطلبات التي تأتي من تطبيقات توصيل أخرى (مثل Talabat, Uber Eats)

#### **ج) mykeeto** - طلبات Mykeeto
الطلبات الخاصة بنظام Mykeeto

### 3. **الإحصائيات** (`statistics`)
- `totalOrders`: عدد الطلبات
- `totalRevenue`: إجمالي الإيرادات
- `subtotal`: قيمة الطعام فقط

### 4. **تقسيم طرق الدفع** (`paymentBreakdown`)
- `cash`: المبالغ النقدية
- `visa`: المبالغ المدفوعة بالفيزا
- `wallet`: المبالغ المدفوعة من المحفظة

### 5. **الرسوم** (`fees`)
- `deliveryFee`: رسوم التوصيل (تذهب للمطعم)
- `serviceFee`: رسوم الخدمة (تذهب للمنصة)
- `commission`: العمولة (تذهب للمنصة)
- `commissionRate`: نسبة العمولة

### 6. **المستحقات** (`cashDue`)
- `cashCollected`: النقدية المحصلة من المطعم
- `restaurantOwesToPlatform`: ما يدينه المطعم للمنصة
- `platformOwesToRestaurant`: ما تدينه المنصة للمطعم
- `netBalance`: الرصيد النهائي
- `balanceStatus`: وصف الحالة بالعربي

### 7. **الإجماليات** (`totals`)
مجموع كل البيانات من جميع أنواع الطلبات

---

## 🎯 حالات الاستخدام

### 1. عرض تقرير مطعم معين
```javascript
async function getRestaurantReport(restaurantId) {
  const response = await fetch(
    `/api/admin/reports/restaurant/${restaurantId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const data = await response.json();
  return data.data;
}
```

### 2. عرض التقرير حسب نوع الطلب
```javascript
const report = await getRestaurantReport('abc-123');

report.reportBySource.forEach(source => {
  console.log(`\n${source.orderSourceName}:`);
  console.log(`  الطلبات: ${source.statistics.totalOrders}`);
  console.log(`  الإيرادات: ${source.statistics.totalRevenue}`);
  console.log(`  ${source.cashDue.balanceStatus}`);
});
```

### 3. حساب إجمالي المستحقات
```javascript
const totals = report.totals;
console.log('إجمالي الإيرادات:', totals.totalRevenue);
console.log('إجمالي النقدي:', totals.paymentBreakdown.cash);
console.log('إجمالي الفيزا:', totals.paymentBreakdown.visa);
console.log('إجمالي المحفظة:', totals.paymentBreakdown.wallet);
console.log(totals.cashDue.balanceStatus);
```

### 4. مقارنة أنواع الطلبات
```javascript
const onlineOrders = report.reportBySource.find(s => s.orderSource === 'online_order');
const aggregatorOrders = report.reportBySource.find(s => s.orderSource === 'food_aggregator');
const mykeetoOrders = report.reportBySource.find(s => s.orderSource === 'mykeeto');

console.log('مقارنة الطلبات:');
console.log(`  أونلاين: ${onlineOrders.statistics.totalOrders} طلب`);
console.log(`  تطبيقات أخرى: ${aggregatorOrders.statistics.totalOrders} طلب`);
console.log(`  Mykeeto: ${mykeetoOrders.statistics.totalOrders} طلب`);
```

---

## 📱 مثال على UI Component

### React Component:
```typescript
import React, { useEffect, useState } from 'react';

interface RestaurantReport {
  restaurant: {
    id: string;
    name: string;
  };
  reportBySource: Array<{
    orderSource: string;
    orderSourceName: string;
    statistics: {
      totalOrders: number;
      totalRevenue: string;
    };
    paymentBreakdown: {
      cash: string;
      visa: string;
      wallet: string;
    };
    cashDue: {
      netBalance: string;
      balanceStatus: string;
    };
  }>;
  totals: {
    totalOrders: number;
    totalRevenue: string;
    paymentBreakdown: {
      cash: string;
      visa: string;
      wallet: string;
    };
    cashDue: {
      netBalance: string;
      balanceStatus: string;
    };
  };
}

export const RestaurantReportPage: React.FC<{ restaurantId: string }> = ({ restaurantId }) => {
  const [report, setReport] = useState<RestaurantReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReport();
  }, [restaurantId]);

  const fetchReport = async () => {
    try {
      const response = await fetch(
        `/api/admin/reports/restaurant/${restaurantId}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      );
      const data = await response.json();
      setReport(data.data);
    } catch (error) {
      console.error('Error fetching report:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>جاري التحميل...</div>;
  if (!report) return <div>لا توجد بيانات</div>;

  return (
    <div className="restaurant-report">
      <h1>{report.restaurant.name}</h1>
      
      {/* الإجماليات */}
      <div className="totals-section">
        <h2>الإجماليات</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <h3>إجمالي الطلبات</h3>
            <p>{report.totals.totalOrders}</p>
          </div>
          <div className="stat-card">
            <h3>إجمالي الإيرادات</h3>
            <p>{report.totals.totalRevenue} جنيه</p>
          </div>
          <div className="stat-card">
            <h3>نقدي</h3>
            <p>{report.totals.paymentBreakdown.cash} جنيه</p>
          </div>
          <div className="stat-card">
            <h3>فيزا</h3>
            <p>{report.totals.paymentBreakdown.visa} جنيه</p>
          </div>
          <div className="stat-card">
            <h3>محفظة</h3>
            <p>{report.totals.paymentBreakdown.wallet} جنيه</p>
          </div>
        </div>
        
        <div className="balance-status">
          <h3>الرصيد النهائي</h3>
          <p className={parseFloat(report.totals.cashDue.netBalance) > 0 ? 'positive' : 'negative'}>
            {report.totals.cashDue.balanceStatus}
          </p>
        </div>
      </div>

      {/* التقرير حسب نوع الطلب */}
      <div className="by-source-section">
        <h2>التقرير حسب نوع الطلب</h2>
        {report.reportBySource.map((source) => (
          <div key={source.orderSource} className="source-card">
            <h3>{source.orderSourceName}</h3>
            
            <div className="source-stats">
              <p>الطلبات: {source.statistics.totalOrders}</p>
              <p>الإيرادات: {source.statistics.totalRevenue} جنيه</p>
            </div>
            
            <div className="payment-breakdown">
              <p>نقدي: {source.paymentBreakdown.cash} جنيه</p>
              <p>فيزا: {source.paymentBreakdown.visa} جنيه</p>
              <p>محفظة: {source.paymentBreakdown.wallet} جنيه</p>
            </div>
            
            <div className="balance">
              <p>{source.cashDue.balanceStatus}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## 🔍 استعلامات مفيدة

### 1. الحصول على أكثر نوع طلب
```javascript
const mostOrdersSource = report.reportBySource.reduce((max, source) => 
  source.statistics.totalOrders > max.statistics.totalOrders ? source : max
);

console.log(`أكثر نوع طلب: ${mostOrdersSource.orderSourceName}`);
```

### 2. حساب نسبة كل طريقة دفع
```javascript
const totalRevenue = parseFloat(report.totals.totalRevenue);
const cashPercentage = (parseFloat(report.totals.paymentBreakdown.cash) / totalRevenue) * 100;
const visaPercentage = (parseFloat(report.totals.paymentBreakdown.visa) / totalRevenue) * 100;
const walletPercentage = (parseFloat(report.totals.paymentBreakdown.wallet) / totalRevenue) * 100;

console.log(`نقدي: ${cashPercentage.toFixed(2)}%`);
console.log(`فيزا: ${visaPercentage.toFixed(2)}%`);
console.log(`محفظة: ${walletPercentage.toFixed(2)}%`);
```

### 3. مقارنة المستحقات حسب نوع الطلب
```javascript
report.reportBySource.forEach(source => {
  const netBalance = parseFloat(source.cashDue.netBalance);
  const status = netBalance > 0 ? '✅ المنصة تدين' : '❌ المطعم يدين';
  
  console.log(`${source.orderSourceName}: ${status} - ${Math.abs(netBalance).toFixed(2)} جنيه`);
});
```

---

## ⚠️ ملاحظات مهمة

1. **التقرير يشمل فقط الطلبات المسلمة** (`status = "delivered"`)
2. **يجب أن يكون للمطعم خطة عمل** لحساب العمولة بشكل صحيح
3. **الفلترة بالتاريخ اختيارية** - بدون تاريخ يعرض كل الطلبات
4. **الحسابات تأخذ في الاعتبار نسبة كل طريقة دفع** من إجمالي الإيرادات

---

## 🔐 الصلاحيات المطلوبة

- Permission: `reports` - `View`
- يجب أن يكون المستخدم مسجل دخول (Authenticated)

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

تم إنشاء هذا الدليل بواسطة Kiro AI 🤖
