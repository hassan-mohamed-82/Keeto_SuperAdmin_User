// 📊 مثال على استخدام API تقرير المطعم الواحد

// ==========================================
// 1. استدعاء الـ API
// ==========================================
async function getRestaurantReport(restaurantId, startDate, endDate) {
  const token = localStorage.getItem('token'); // أو من أي مكان تخزن فيه الـ token
  
  let url = `/api/admin/report/restaurant/${restaurantId}`;
  
  // إضافة query parameters إذا كانت موجودة
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  
  if (params.toString()) {
    url += `?${params.toString()}`;
  }
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error fetching restaurant report:', error);
    throw error;
  }
}

// ==========================================
// 2. عرض البيانات في Console
// ==========================================
async function displayRestaurantReport(restaurantId) {
  try {
    const report = await getRestaurantReport(
      restaurantId,
      '2024-01-01',
      '2024-01-31'
    );
    
    console.log('='.repeat(50));
    console.log(`📊 تقرير مطعم: ${report.restaurant.name}`);
    console.log('='.repeat(50));
    
    // الإجماليات
    console.log('\n📈 الإجماليات:');
    console.log(`  إجمالي الطلبات: ${report.totals.totalOrders}`);
    console.log(`  إجمالي الإيرادات: ${report.totals.totalRevenue} جنيه`);
    console.log(`  نقدي: ${report.totals.paymentBreakdown.cash} جنيه`);
    console.log(`  فيزا: ${report.totals.paymentBreakdown.visa} جنيه`);
    console.log(`  محفظة: ${report.totals.paymentBreakdown.wallet} جنيه`);
    
    // الرصيد النهائي
    console.log('\n💰 الرصيد النهائي:');
    console.log(`  ${report.totals.cashDue.balanceStatus}`);
    
    // التقرير حسب نوع الطلب
    console.log('\n📊 التقرير حسب نوع الطلب:');
    report.reportBySource.forEach(source => {
      console.log(`\n  ${source.orderSourceName}:`);
      console.log(`    الطلبات: ${source.statistics.totalOrders}`);
      console.log(`    الإيرادات: ${source.statistics.totalRevenue} جنيه`);
      console.log(`    نقدي: ${source.paymentBreakdown.cash} جنيه`);
      console.log(`    فيزا: ${source.paymentBreakdown.visa} جنيه`);
      console.log(`    محفظة: ${source.paymentBreakdown.wallet} جنيه`);
      console.log(`    ${source.cashDue.balanceStatus}`);
    });
    
    console.log('\n' + '='.repeat(50));
    
    return report;
  } catch (error) {
    console.error('خطأ في عرض التقرير:', error);
  }
}

// ==========================================
// 3. إنشاء HTML Table
// ==========================================
function createReportTable(report) {
  const table = document.createElement('table');
  table.className = 'restaurant-report-table';
  
  // Header
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>نوع الطلب</th>
      <th>عدد الطلبات</th>
      <th>الإيرادات</th>
      <th>نقدي</th>
      <th>فيزا</th>
      <th>محفظة</th>
      <th>الرصيد</th>
    </tr>
  `;
  table.appendChild(thead);
  
  // Body
  const tbody = document.createElement('tbody');
  report.reportBySource.forEach(source => {
    const row = document.createElement('tr');
    const netBalance = parseFloat(source.cashDue.netBalance);
    const balanceClass = netBalance > 0 ? 'positive' : netBalance < 0 ? 'negative' : 'neutral';
    
    row.innerHTML = `
      <td>${source.orderSourceName}</td>
      <td>${source.statistics.totalOrders}</td>
      <td>${source.statistics.totalRevenue} جنيه</td>
      <td>${source.paymentBreakdown.cash} جنيه</td>
      <td>${source.paymentBreakdown.visa} جنيه</td>
      <td>${source.paymentBreakdown.wallet} جنيه</td>
      <td class="${balanceClass}">${source.cashDue.balanceStatus}</td>
    `;
    tbody.appendChild(row);
  });
  
  // Footer (Totals)
  const tfoot = document.createElement('tfoot');
  const totalNetBalance = parseFloat(report.totals.cashDue.netBalance);
  const totalBalanceClass = totalNetBalance > 0 ? 'positive' : totalNetBalance < 0 ? 'negative' : 'neutral';
  
  tfoot.innerHTML = `
    <tr class="totals-row">
      <td><strong>الإجمالي</strong></td>
      <td><strong>${report.totals.totalOrders}</strong></td>
      <td><strong>${report.totals.totalRevenue} جنيه</strong></td>
      <td><strong>${report.totals.paymentBreakdown.cash} جنيه</strong></td>
      <td><strong>${report.totals.paymentBreakdown.visa} جنيه</strong></td>
      <td><strong>${report.totals.paymentBreakdown.wallet} جنيه</strong></td>
      <td class="${totalBalanceClass}"><strong>${report.totals.cashDue.balanceStatus}</strong></td>
    </tr>
  `;
  table.appendChild(tfoot);
  
  return table;
}

// ==========================================
// 4. إنشاء Cards للإحصائيات
// ==========================================
function createStatsCards(report) {
  const container = document.createElement('div');
  container.className = 'stats-cards-container';
  
  const stats = [
    {
      title: 'إجمالي الطلبات',
      value: report.totals.totalOrders,
      icon: '📦'
    },
    {
      title: 'إجمالي الإيرادات',
      value: `${report.totals.totalRevenue} جنيه`,
      icon: '💰'
    },
    {
      title: 'نقدي',
      value: `${report.totals.paymentBreakdown.cash} جنيه`,
      icon: '💵'
    },
    {
      title: 'فيزا',
      value: `${report.totals.paymentBreakdown.visa} جنيه`,
      icon: '💳'
    },
    {
      title: 'محفظة',
      value: `${report.totals.paymentBreakdown.wallet} جنيه`,
      icon: '👛'
    }
  ];
  
  stats.forEach(stat => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <div class="stat-icon">${stat.icon}</div>
      <div class="stat-title">${stat.title}</div>
      <div class="stat-value">${stat.value}</div>
    `;
    container.appendChild(card);
  });
  
  return container;
}

// ==========================================
// 5. إنشاء Balance Card
// ==========================================
function createBalanceCard(report) {
  const netBalance = parseFloat(report.totals.cashDue.netBalance);
  const isPositive = netBalance > 0;
  
  const card = document.createElement('div');
  card.className = `balance-card ${isPositive ? 'positive' : 'negative'}`;
  
  card.innerHTML = `
    <div class="balance-icon">${isPositive ? '✅' : '❌'}</div>
    <div class="balance-title">الرصيد النهائي</div>
    <div class="balance-amount">${Math.abs(netBalance).toFixed(2)} جنيه</div>
    <div class="balance-status">${report.totals.cashDue.balanceStatus}</div>
    <div class="balance-details">
      <div class="detail-row">
        <span>المطعم يدين للمنصة:</span>
        <span>${report.totals.cashDue.restaurantOwesToPlatform} جنيه</span>
      </div>
      <div class="detail-row">
        <span>المنصة تدين للمطعم:</span>
        <span>${report.totals.cashDue.platformOwesToRestaurant} جنيه</span>
      </div>
    </div>
  `;
  
  return card;
}

// ==========================================
// 6. حساب النسب المئوية
// ==========================================
function calculatePercentages(report) {
  const totalRevenue = parseFloat(report.totals.totalRevenue);
  
  if (totalRevenue === 0) {
    return {
      cash: 0,
      visa: 0,
      wallet: 0
    };
  }
  
  return {
    cash: ((parseFloat(report.totals.paymentBreakdown.cash) / totalRevenue) * 100).toFixed(2),
    visa: ((parseFloat(report.totals.paymentBreakdown.visa) / totalRevenue) * 100).toFixed(2),
    wallet: ((parseFloat(report.totals.paymentBreakdown.wallet) / totalRevenue) * 100).toFixed(2)
  };
}

// ==========================================
// 7. مثال على استخدام كامل
// ==========================================
async function initRestaurantReportPage(restaurantId) {
  try {
    // جلب البيانات
    const report = await getRestaurantReport(restaurantId, '2024-01-01', '2024-01-31');
    
    // إنشاء العناصر
    const statsCards = createStatsCards(report);
    const balanceCard = createBalanceCard(report);
    const reportTable = createReportTable(report);
    
    // حساب النسب
    const percentages = calculatePercentages(report);
    console.log('نسب طرق الدفع:', percentages);
    
    // إضافة العناصر للصفحة
    const container = document.getElementById('report-container');
    if (container) {
      container.innerHTML = '';
      container.appendChild(statsCards);
      container.appendChild(balanceCard);
      container.appendChild(reportTable);
    }
    
    return report;
  } catch (error) {
    console.error('Error initializing report page:', error);
  }
}

// ==========================================
// 8. CSS للتنسيق (يمكن وضعه في ملف منفصل)
// ==========================================
const styles = `
<style>
.stats-cards-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: white;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  text-align: center;
}

.stat-icon {
  font-size: 40px;
  margin-bottom: 10px;
}

.stat-title {
  color: #666;
  font-size: 14px;
  margin-bottom: 5px;
}

.stat-value {
  color: #333;
  font-size: 24px;
  font-weight: bold;
}

.balance-card {
  background: white;
  border-radius: 10px;
  padding: 30px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  margin-bottom: 30px;
  text-align: center;
}

.balance-card.positive {
  border-left: 5px solid #4CAF50;
}

.balance-card.negative {
  border-left: 5px solid #f44336;
}

.balance-icon {
  font-size: 60px;
  margin-bottom: 10px;
}

.balance-title {
  color: #666;
  font-size: 18px;
  margin-bottom: 10px;
}

.balance-amount {
  color: #333;
  font-size: 36px;
  font-weight: bold;
  margin-bottom: 10px;
}

.balance-status {
  color: #666;
  font-size: 16px;
  margin-bottom: 20px;
}

.balance-details {
  border-top: 1px solid #eee;
  padding-top: 20px;
  margin-top: 20px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 14px;
}

.restaurant-report-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.restaurant-report-table th,
.restaurant-report-table td {
  padding: 15px;
  text-align: right;
  border-bottom: 1px solid #eee;
}

.restaurant-report-table th {
  background: #f5f5f5;
  font-weight: bold;
  color: #333;
}

.restaurant-report-table .totals-row {
  background: #f9f9f9;
  font-weight: bold;
}

.restaurant-report-table .positive {
  color: #4CAF50;
}

.restaurant-report-table .negative {
  color: #f44336;
}

.restaurant-report-table .neutral {
  color: #666;
}
</style>
`;

// ==========================================
// 9. مثال على الاستخدام
// ==========================================

// في صفحة HTML:
// <div id="report-container"></div>

// في JavaScript:
// const restaurantId = 'abc-123-def-456';
// initRestaurantReportPage(restaurantId);

// أو للعرض في Console فقط:
// displayRestaurantReport('abc-123-def-456');

// ==========================================
// 10. Export للاستخدام في Modules
// ==========================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getRestaurantReport,
    displayRestaurantReport,
    createReportTable,
    createStatsCards,
    createBalanceCard,
    calculatePercentages,
    initRestaurantReportPage
  };
}
