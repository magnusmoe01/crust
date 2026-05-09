# Financial Report Setup Guide

## Problem Summary
Your financial report is showing incomplete data because:
- Planday employee IDs don't match Firebase employee IDs
- No mapping exists between the two systems
- Reports show "Unknown" locations for unmatched employees
- Results are missing from all locations

## Solution Overview

The system now includes:
1. ✅ **Automatic Planday ID Storage** - Planday employee IDs are stored in Firebase
2. ✅ **Enhanced Employee Lookup** - Multiple matching strategies (Planday ID → Firebase ID)
3. ✅ **Manual Mapping Support** - Users can upload employee-location mappings
4. ✅ **Better UI** - Shows unmatched employees with download template

---

## Step-by-Step Setup

### Step 1: Sync Planday Employees to Firebase

First, ensure your Planday employees are synced with their IDs stored in Firebase:

**Option A: Automatic Sync (Recommended)**
1. Go to Admin Panel → [Create endpoint for sync if needed]
2. Click "Sync Employees from Planday"
3. This stores both Planday ID and location in each employee record

**Option B: Manual Verification**
1. Check Firebase Console → Firestore → `employees` collection
2. Each employee should have these fields:
   ```json
   {
     "id": "firebase-doc-id",
     "plandayId": "6076",           // ← Added by sync
     "plandayEmployeeId": "6076",   // ← Alternative field name
     "name": "Employee Name",
     "location": "Oslo",             // ← Your location
     "rate": 150,                    // Hourly rate
     ...
   }
   ```

### Step 2: Generate Financial Report

1. Open **Financial Report** page from Admin panel
2. Set date range (e.g., last 7 days)
3. Select locations (leave empty for "All")
4. Click **"Generate Report"**

### Step 3: If Unmatched Employees Appear

The report will show a section like this:

```
⚠️ Unmatched Employee IDs (8)
These employee IDs from Planday don't have corresponding Firebase records.
```

**This is normal!** It means:
- The payroll export contains salary IDs such as `6076, 6080, 105300, 6075, 107167, 6077, 6038, 6081, 6082, 6006`
- These IDs don't match any Firebase employee record

**To fix:**

1. Click **"Download CSV Template"** button
   - This creates a file like:
   ```
   SalaryId;Location
   6076;Oslo
   6080;Oslo
   105300;Oslo
   ```

2. Open the CSV in Excel/Sheets and update locations:
   ```
   SalaryId;Location
   6076;Oslo
   6080;Bergen
   105300;Gjøvik
   6075;Oslo
   107167;Bergen
   6077;Gjøvik
   6038;Oslo
   6081;Bergen
   6082;Oslo
   6006;Gjøvik
   ```

3. Save the file

4. Upload in "Employee Location Map CSV" field

5. Click **"Generate Report"** again

---

## CSV Format Reference

### Employee Location Map CSV

**Header:** `SalaryId;Location` (semicolon-separated)

**Valid Locations:** 
- Oslo
- Bergen
- Gjøvik

**Example:**
```csv
SalaryId;Location
6076;Oslo
6080;Bergen
105300;Gjøvik
```

### Payroll CSV (if using fallback)

**Headers:** `Ansattnummer;SalaryId;Antall;Sats;Location`

```csv
Ansattnummer;SalaryId;Antall;Sats;Location;Department
6076;6076;8;150;Oslo;Oslo
6080;6080;8;160;Bergen;Bergen
```

---

## How the Matching Works

The system tries to match employees in this order:

1. **Exact Planday ID match** ← Fastest, most reliable
2. **Normalized Planday ID** (removes leading zeros)
3. **Employee record lookup** by ID
4. **CSV manual mapping** override
5. **Department-based default** (Oslo, Bergen, Gjøvik)

### Example Matching

**Planday API returns:**
```json
{
  "employeeId": "6076",
  "departmentId": 19766,
  "hours": 8,
  "amount": 1200
}
```

**System matches:**
```
1. Check: Does "6076" exist in plandayIdMap? 
   → YES! Found employee "John Doe" in Firebase
   
2. Get location from: 
   → Firebase employee record: "Oslo"
   
3. Add salary to: "Oslo" total
```

---

## Troubleshooting

### Issue: Still showing "Unknown" locations

**Check:**
1. Did you upload the employee location CSV?
2. Is it formatted correctly? (`SalaryId;Location`)
3. Are location names spelled exactly: "Oslo", "Bergen", "Gjøvik"?

**Fix:**
- Re-download template from report page
- Fill in ALL unmatched employee IDs
- Re-upload and regenerate

### Issue: Some locations missing from report

**Check:**
1. Are all employees mapped to their correct location?
2. Do Zettle income records exist for that location?

**Fix:**
- Verify employee locations in Firebase
- Check Zettle is configured for all locations
- See logs in Cloud Functions

### Issue: Numbers don't match Planday

**Check:**
1. Date range matches Planday reporting period
2. All employees have `plandayId` field in Firebase
3. No employees filtered out by location selection

---

## API Details

### Cloud Function: `financialReport`

**Endpoint:** `POST /financialReport`

**Request:**
```json
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-07",
  "locations": ["Oslo", "Bergen"],
  "csvPayrollRows": [],
  "csvIncomeRows": [],
  "employeeLocationMap": {
    "6076": "Oslo",
    "6080": "Bergen"
  }
}
```

**Response:**
```json
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-07",
  "totalIncome": 15000,
  "totalSalary": 9600,
  "totalProfit": 5400,
  "totalHours": 64,
  "marginPercent": 36,
  "unmatchedEmployeeIds": [],
  "warnings": [],
  "incomeSource": "zettle_api",
  "salarySource": "planday_api",
  "byLocation": {
    "Oslo": {
      "income": 8000,
      "salary": 5000,
      "hours": 32,
      "profit": 3000,
      "marginPercent": 37.5
    },
    "Bergen": {
      "income": 7000,
      "salary": 4600,
      "hours": 32,
      "profit": 2400,
      "marginPercent": 34.3
    }
  }
}
```

---

## Next Steps

1. ✅ Run employee sync from Planday
2. ✅ Generate your first financial report
3. ✅ Download employee mapping template if needed
4. ✅ Upload mapping and regenerate
5. ✅ Verify all locations appear in results

**Result:** Complete financial reports with accurate salary costs and profit margins for all locations!
