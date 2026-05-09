const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Returns Map<employeeId, employeeData>
 */
async function getEmployeeMap() {
  const snapshot = await db.collection("employees").get();

  const map = new Map();

  snapshot.forEach((doc) => {
    const d = doc.data();

    const emp = {
      id: doc.id,
      name: d.name || "Unknown",
      location: d.location || "Unknown",
      rate: Number(d.rate || 0),
      group: d.group || "Unknown",
      plandayId: d.plandayId || d.plandayEmployeeId || d.planday_employee_id || "",
      salaryId: d.salaryId || d.salary_id || "",
      employeeNumber: d.employeeNumber || d.employee_number || "",
    };

    map.set(doc.id, emp);
    // Also map by Planday ID for easier lookups
    if (emp.plandayId) {
      map.set(`planday_${emp.plandayId}`, emp);
    }
    if (emp.salaryId) {
      map.set(`salary_${emp.salaryId}`, emp);
    }
  });

  return map;
}

module.exports = {
  getEmployeeMap,
};