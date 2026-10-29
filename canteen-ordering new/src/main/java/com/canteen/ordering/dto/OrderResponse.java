package com.canteen.ordering.dto;

import com.canteen.ordering.model.Order;
import com.canteen.ordering.model.OrderItem;
import com.canteen.ordering.model.OrderStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record OrderResponse(
        Long id,
        Integer queueNumber,
        String customerName,
        String notes,
        List<Line> items,
        BigDecimal totalAmount,
        OrderStatus status,
        Instant createdAt,
        Instant updatedAt
) {

    public record Line(
            Long id,
            Long menuItemId,
            String name,
            BigDecimal unitPrice,
            int quantity,
            BigDecimal lineTotal
    ) {
        static Line from(OrderItem item) {
            return new Line(
                    item.getId(),
                    item.getMenuItemId(),
                    item.getName(),
                    item.getUnitPrice(),
                    item.getQuantity(),
                    item.getLineTotal()
            );
        }
    }

    public static OrderResponse from(Order order) {
        return new OrderResponse(
                order.getId(),
                order.getQueueNumber(),
                order.getCustomerName(),
                order.getNotes(),
                order.getItems().stream().map(Line::from).toList(),
                order.getTotalAmount(),
                order.getStatus(),
                order.getCreatedAt(),
                order.getUpdatedAt()
        );
    }
}
