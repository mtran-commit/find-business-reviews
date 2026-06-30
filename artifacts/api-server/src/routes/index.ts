import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reviewsRouter from "./reviews";
import summaryRouter from "./summary";

const router: IRouter = Router();

router.use(healthRouter);
router.use(reviewsRouter);
router.use(summaryRouter);

export default router;
