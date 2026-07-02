import { Router, type IRouter } from "express";
import healthRouter from "./health";
import businessRouter from "./business";
import analyzeRouter from "./analyze";
import reportRequestsRouter from "./reportRequests";

const router: IRouter = Router();

router.use(healthRouter);
router.use(businessRouter);
router.use(analyzeRouter);
router.use(reportRequestsRouter);

export default router;
