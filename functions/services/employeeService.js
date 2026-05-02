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

    map.set(doc.id, {
      id: doc.id,
      name: d.name || "Unknown",
      location: d.location || "Unknown",
      rate: Number(d.rate || 0),
      group: d.group || "Unknown",
    });
  });

  return map;
}

module.exports = {
  getEmployeeMap,
};