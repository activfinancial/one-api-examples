import { SubscriptionMessage, getExchangeCode, FieldId, Rational } from "@activfinancial/one-api";
import { formatField } from "../../common/formatFieldValue";

export class OrderEntry {
    readonly exchange: string;
    readonly orderKey: string;
    readonly orderId: string;
    readonly price: string;
    readonly priceDoubleValue: number;
    readonly size: string;
    readonly time: string;
    readonly date: string;
    readonly isBuy: boolean;
    readonly participant: string;

    constructor(message: SubscriptionMessage, existingOrderEntry: OrderEntry | undefined, useAsciiOrderId: boolean) {
        this.exchange = getExchangeCode(message.symbol);
        if (message.mapKey === undefined) throw new Error("Map key must be defined.");
        this.orderKey = message.mapKey;

        const buySell = message.fieldData.getField(FieldId.FID_ORDER_BUY_SELL);
        this.isBuy = buySell.value == "B";

        if (
            !(
                message.fieldData.isFieldPresent(FieldId.FID_ORDER_PRICE) &&
                message.fieldData.isFieldPresent(FieldId.FID_ORDER_SIZE) &&
                message.fieldData.isFieldPresent(FieldId.FID_ORDER_TIME) &&
                message.fieldData.isFieldPresent(FieldId.FID_ORDER_DATE) &&
                message.fieldData.isFieldPresent(FieldId.FID_PARTICIPANT)
            )
        ) {
            throw new Error("Missing expected order fields");
        }
        this.orderId = useAsciiOrderId ? formatField(message.fieldData.getField(FieldId.FID_ORDER_ID)) : this.orderKey;
        let price = message.fieldData.getField(FieldId.FID_ORDER_PRICE);
        let size = message.fieldData.getField(FieldId.FID_ORDER_SIZE);
        let time = message.fieldData.getField(FieldId.FID_ORDER_TIME);
        let date = message.fieldData.getField(FieldId.FID_ORDER_DATE);
        let participant = message.fieldData.getField(FieldId.FID_PARTICIPANT);

        if (price.doesUpdateLastValue) {
            this.price = formatField(price);
            this.priceDoubleValue = (price.value as Rational).doubleValue;
        } else {
            this.price = existingOrderEntry !== undefined ? existingOrderEntry.price : "";
            this.priceDoubleValue = existingOrderEntry !== undefined ? existingOrderEntry.priceDoubleValue : -1;
        }

        if (size.doesUpdateLastValue) {
            this.size = formatField(size);
        } else {
            this.size = existingOrderEntry !== undefined ? existingOrderEntry.size : "";
        }
        if (time.doesUpdateLastValue) {
            this.time = formatField(time);
        } else {
            this.time = existingOrderEntry !== undefined ? existingOrderEntry.time : "";
        }
        if (date.doesUpdateLastValue) {
            this.date = formatField(date);
        } else {
            this.date = existingOrderEntry !== undefined ? existingOrderEntry.date : "";
        }
        if (participant.doesUpdateLastValue) {
            this.participant = formatField(participant);
        } else {
            this.participant = existingOrderEntry !== undefined ? existingOrderEntry.participant : "";
        }
    }
}
