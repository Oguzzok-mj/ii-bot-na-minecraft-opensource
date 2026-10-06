from pathlib import Path
import numpy as np

ACTIONS = ("explore", "approach", "chop", "pickup")
FEATURES = ("log_visible", "log_distance", "can_chop", "drop_visible",
            "drop_distance", "health", "food")


def features(state):

    log, drop = state.get("log"), state.get("drop")
    return np.array([
        float(log is not None), min(log["distance"] / 32, 1) if log else 1,
        float(bool(log and log["can_chop"])), float(drop is not None),
        min(drop["distance"] / 32, 1) if drop else 1,
        np.clip(state.get("health", 20) / 20, 0, 1),
        np.clip(state.get("food", 20) / 20, 0, 1),
    ], dtype=np.float64)


def teacher(state):

    if state.get("drop") and state["drop"]["distance"] < 8:
        return "pickup"
    if state.get("log"):
        return "chop" if state["log"]["can_chop"] else "approach"
    return "explore"


class Brain:
    def __init__(self, seed=42):
        rng = np.random.default_rng(seed)
        self.w1 = rng.normal(0, .25, (len(FEATURES), 32))
        self.b1 = np.zeros(32)
        self.w2 = rng.normal(0, .15, (32, len(ACTIONS)))
        self.b2 = np.zeros(len(ACTIONS))

    def forward(self, x):
        hidden = np.tanh(x @ self.w1 + self.b1)
        logits = hidden @ self.w2 + self.b2
        logits -= np.max(logits, axis=-1, keepdims=True)
        exp = np.exp(logits)
        return hidden, exp / exp.sum(axis=-1, keepdims=True)

    def probabilities(self, state):
        return self.forward(features(state)[None, :])[1][0]

    def predict(self, state):
        return ACTIONS[int(np.argmax(self.probabilities(state)))]

    def accuracy(self, x, y):
        return float(np.mean(self.forward(x)[1].argmax(axis=1) == y))

    def fit(self, x, y, *, epochs=120, learning_rate=.05, seed=42, progress=None):
        if len(x) < 20:
            raise ValueError("Нужно минимум 20 успешных учебных примеров.")
        rng = np.random.default_rng(seed)
        order = rng.permutation(len(x))
        split = max(1, int(.2 * len(x)))
        valid, train = order[:split], order[split:]

        counts = np.bincount(y[train], minlength=len(ACTIONS))
        weights = len(train) / (len(ACTIONS) * np.maximum(counts, 1))
        for epoch in range(1, epochs + 1):
            shuffled = rng.permutation(train)
            for start in range(0, len(shuffled), 128):
                ids = shuffled[start:start + 128]
                xb, yb = x[ids], y[ids]
                hidden, probs = self.forward(xb)

                delta = probs.copy()
                delta[np.arange(len(ids)), yb] -= 1
                delta *= weights[yb, None] / len(ids)
                grad_w2, grad_b2 = hidden.T @ delta, delta.sum(axis=0)
                hidden_delta = (delta @ self.w2.T) * (1 - hidden ** 2)
                grad_w1, grad_b1 = xb.T @ hidden_delta, hidden_delta.sum(axis=0)
                self.w1 -= learning_rate * grad_w1
                self.b1 -= learning_rate * grad_b1
                self.w2 -= learning_rate * grad_w2
                self.b2 -= learning_rate * grad_b2
            if progress and (epoch == 1 or epoch % 20 == 0 or epoch == epochs):
                probs = self.forward(x[train])[1]
                loss = -np.log(np.maximum(probs[np.arange(len(train)), y[train]], 1e-12)).mean()
                progress(epoch, float(loss), self.accuracy(x[valid], y[valid]))
        return self.accuracy(x[valid], y[valid])

    def save(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(path, w1=self.w1, b1=self.b1, w2=self.w2, b2=self.b2,
                 features=np.array(FEATURES), actions=np.array(ACTIONS))

    @classmethod
    def load(cls, path):
        brain = cls()
        with np.load(path, allow_pickle=False) as values:
            if tuple(values["features"]) != FEATURES or tuple(values["actions"]) != ACTIONS:
                raise ValueError("Модель использует другой набор признаков или действий.")
            for name in ("w1", "b1", "w2", "b2"):
                value = values[name]
                if value.shape != getattr(brain, name).shape or not np.isfinite(value).all():
                    raise ValueError(f"Некорректные веса: {name}")
                setattr(brain, name, value.copy())
        return brain
