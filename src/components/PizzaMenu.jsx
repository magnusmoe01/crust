import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import "./PizzaMenu.css";

const DEFAULT_PIZZAS = [
  {
    id: "margherita",
    name: "Margherita",
    description: "Tomatbunn, mozzarella og fersk basilikum.",
    image: "",
  },
  {
    id: "pepperoni",
    name: "Pepperoni",
    description: "Tomatbunn, mozzarella og pepperoni.",
    image: "",
  },
  {
    id: "bbq-chicken",
    name: "BBQ Chicken",
    description: "BBQ-saus, kylling, mozzarella og rødløk.",
    image: "",
  },
  {
    id: "veggie",
    name: "Veggie",
    description: "Tomatbunn, mozzarella, paprika, sopp og oliven.",
    image: "",
  },
];

function PizzaMenu() {
  const [pizzas, setPizzas] = useState(DEFAULT_PIZZAS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "siteSettings", "pizzaMenu"),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.pizzas) && data.pizzas.length > 0) {
            setPizzas(data.pizzas);
          }
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  if (loading) {
    return <div className="pizza-menu-loading">Laster meny...</div>;
  }

  return (
    <div className="pizza-menu-grid" role="list">
      {pizzas.map((pizza) => (
        <article key={pizza.id} className="pizza-card" role="listitem">
          {pizza.image ? (
            <img
              className="pizza-card-img"
              src={pizza.image}
              alt={pizza.name}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div
              className="pizza-card-img"
              role="img"
              aria-label={pizza.name}
            />
          )}
          <div className="pizza-card-body">
            <h3>{pizza.name}</h3>
            <p>{pizza.description}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export default PizzaMenu;
