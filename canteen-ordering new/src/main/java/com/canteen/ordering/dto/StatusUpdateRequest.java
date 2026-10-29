package com.canteen.ordering.dto;

import com.canteen.ordering.model.OrderStatus;
import jakarta.validation.constraints.NotNull;

public record StatusUpdateRequest(
        @NotNull(message = "Status is required")
        OrderStatus status
) {
}
